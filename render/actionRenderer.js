/*
 * Action renderer — applies an ActionPlan to a frame.
 *
 * Render order per design section 8:
 *   1. Source video (with sourceOpacity + contrast/saturation filter)
 *   2. Background tint (global blend mode)
 *   3. Trails (batched once per frame)
 *   4. Object-local edges / lines
 *   5. Spotlight, aura, glitch
 *   6. Labels (literal | poetic | hidden)
 *   7. Grain + vignette
 *
 * The orchestrator first matches each tracked object against every objectRule
 * in the plan, accumulating actions and (last-rule-wins) the label setting.
 * Actions of the same type are then processed together in dedicated passes so
 * the per-type compositing stays consistent across objects.
 */

import { applyAura } from "./actions/aura.js";
import { applyLocalEdges } from "./actions/localEdges.js";
import { applyLocalLines } from "./actions/localLines.js";
import { applySpotlight } from "./actions/spotlight.js";
import { applyGlitch } from "./actions/glitch.js";
import {
  fadeTrailCanvas,
  paintObjectIntoTrail,
  compositeTrail,
} from "./actions/trail.js";
import { blendMode } from "../llm/actionPlanSchema.js";

// Static noise tile reused for grain. Built once — animating grain by
// rebuilding per frame is too expensive for the visual payoff.
const _noiseTile = (() => {
  const size = 192;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const cx = c.getContext("2d");
  const img = cx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = (Math.random() * 255) | 0;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return c;
})();

function objectMatchesRule(obj, rule, allObjects, largestArea) {
  const s = rule.selector || {};
  if (s.classes && Array.isArray(s.classes) && !s.classes.includes(obj.className)) return false;
  if (s.selectedOnly && !obj.selected) return false;
  if (typeof s.minScore === "number" && obj.score < s.minScore) return false;
  if (s.largestOnly && Math.abs(obj.areaNorm - largestArea) > 1e-6) return false;
  return true;
}

function buildMatches(objects, plan) {
  const live = objects.filter((o) => !o.stale);
  const largestArea = live.reduce((m, o) => Math.max(m, o.areaNorm), 0);
  return live.map((obj) => {
    let label = null;
    const actions = [];
    for (const rule of plan.objectRules || []) {
      if (!objectMatchesRule(obj, rule, live, largestArea)) continue;
      if (rule.label) label = rule.label;
      for (const a of rule.actions || []) actions.push(a);
    }
    return { obj, label, actions };
  });
}

function drawSourceWithGlobalStyle(ctx, captureCanvas, gs, intensity, hideFeed) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  if (!hideFeed) {
    const contrast = 0.5 + (gs.contrast - 0.5) * 2 * intensity;
    const saturation = 1 + (gs.saturation - 0.5) * 2 * intensity;
    ctx.filter = `contrast(${contrast}) saturate(${saturation})`;
    ctx.globalAlpha = 1 - (1 - gs.sourceOpacity) * intensity;
    ctx.drawImage(captureCanvas, 0, 0);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }
}

function drawTint(ctx, gs, intensity) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (!gs.tint) return;
  const [r, g, b] = gs.tint;
  if (r >= 250 && g >= 250 && b >= 250) return; // white = no tint
  ctx.save();
  ctx.globalCompositeOperation = blendMode(gs.blendMode);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.globalAlpha = 0.45 * intensity;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawLabels(ctx, matches, w) {
  const fontSize = Math.max(14, Math.floor(w * 0.018));
  ctx.font = `${fontSize}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "middle";

  for (const { obj, label } of matches) {
    if (!label || label.mode === "hidden") continue;
    let text;
    if (label.mode === "poetic") {
      text = label.text || obj.className;
    } else {
      text = `${obj.className} · ${Math.round(obj.score * 100)}%`;
    }
    const [x, y] = obj.bbox;
    const padX = 8;
    const padY = 4;
    const m = ctx.measureText(text);
    const lw = m.width + padX * 2;
    const lh = fontSize + padY * 2;
    const lx = Math.max(0, x);
    const ly = Math.max(0, y - lh);

    ctx.fillStyle = "rgba(10, 12, 16, 0.7)";
    ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillText(text, lx + padX, ly + lh / 2);
  }
}

function drawGrainAndVignette(ctx, gs, intensity) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (gs.grain > 0) {
    ctx.save();
    const pat = ctx.createPattern(_noiseTile, "repeat");
    ctx.fillStyle = pat;
    ctx.globalAlpha = gs.grain * 0.35 * intensity;
    ctx.globalCompositeOperation = "overlay";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  // Always-on subtle vignette so styled mode reads as cinematic.
  ctx.save();
  const grad = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.42,
    w / 2, h / 2, Math.max(w, h) * 0.78,
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, `rgba(0,0,0,${0.45 * intensity})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export function drawStyledPlan(ctx, captureCanvas, objects, geometries, plan, opts) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const intensity = Math.max(0, Math.min(1, opts.intensity ?? 1));
  const timeMs = opts.timeMs ?? performance.now();
  const gs = plan.globalStyle || {};
  const matches = buildMatches(objects, plan);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // 1 + 2.
  drawSourceWithGlobalStyle(ctx, captureCanvas, gs, intensity, opts.hideFeed);
  drawTint(ctx, gs, intensity);

  // 3. Trails — collect, fade once, paint per object, composite once.
  const trailEntries = [];
  for (const { obj, actions } of matches) {
    for (const a of actions) if (a.type === "trail") trailEntries.push({ obj, a });
  }
  if (trailEntries.length > 0) {
    let lenSum = 0;
    let opSum = 0;
    let smSum = 0;
    for (const { a } of trailEntries) {
      lenSum += a.length || 0;
      opSum += a.opacity || 0;
      smSum += a.smear || 0;
    }
    const avgLength = lenSum / trailEntries.length;
    const avgOpacity = opSum / trailEntries.length;
    const avgSmear = smSum / trailEntries.length;
    fadeTrailCanvas(w, h, avgLength);
    for (const { obj } of trailEntries) {
      paintObjectIntoTrail(obj, captureCanvas, avgSmear);
    }
    compositeTrail(ctx, avgOpacity * intensity);
  }

  // 4. Object-local edges + lines.
  for (const { obj, actions } of matches) {
    const geom = geometries.get(obj.id);
    if (!geom) continue;
    for (const a of actions) {
      if (a.type === "localEdges") applyLocalEdges(ctx, { geometry: geom, action: a, intensity, w });
      else if (a.type === "localLines") applyLocalLines(ctx, { geometry: geom, action: a, intensity, w });
    }
  }

  // 5. Spotlight (background darken), aura (additive glow), glitch (overlay).
  for (const { obj, actions } of matches) {
    for (const a of actions) {
      if (a.type === "spotlight") applySpotlight(ctx, { object: obj, action: a, intensity, w, h });
    }
  }
  for (const { obj, actions } of matches) {
    for (const a of actions) {
      if (a.type === "aura") applyAura(ctx, { object: obj, action: a, intensity, timeMs });
    }
  }
  for (const { obj, actions } of matches) {
    for (const a of actions) {
      if (a.type === "glitch") {
        applyGlitch(ctx, { object: obj, action: a, intensity, captureCanvas, timeMs });
      }
    }
  }

  // 6. Labels.
  drawLabels(ctx, matches, w);

  // 7. Grain + vignette.
  drawGrainAndVignette(ctx, gs, intensity);

  ctx.restore();
}
