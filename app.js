/*
 * Latent Canvas — Phase 4B foreground/background extension.
 *
 * Pipeline:
 *   getUserMedia → hidden <video>
 *     → captureCanvas (mirrored at capture, display space)
 *       → COCO-SSD → raw detections
 *         → tracker → DetectedObject[] (stable ids, smoothed bboxes)
 *           → object-local CV → Map<id, ObjectGeometry>
 *           → sceneSignals → summary for the planner
 *             → renderer:
 *                 - source = "llm"     → drawStyledPlan(state.currentPlan)
 *                 - source = "preset"  → drawStyledPlan(preset.plan)  or neutral
 *
 * Phase 4A added the prompt → plan loop. The frontend POSTs context to
 * /api/plan; planClient falls back to a local deterministic mock when the
 * backend isn't reachable so the prompt UI is functional even on the static
 * dev server. Bad model output cannot crash anything — validateActionPlan
 * sanitizes before the renderer ever sees the plan, and on hard failure we
 * keep the previous plan.
 *
 * Phase 4B adds `foregroundBackground`, an optional scene-level MOG2 mask
 * action that runs only when the active plan includes it.
 */

import { loadDetector, detect } from "./analysis/objectDetector.js";
import { createTracker } from "./analysis/objectTracker.js";
import { computeObjectGeometry, isReady as isCvReady } from "./analysis/objectLocalCv.js";
import {
  computeForegroundBackground,
  isReady as isForegroundBackgroundReady,
  resetForegroundBackgroundModel,
} from "./analysis/foregroundBackground.js";
import { computeSceneSignals } from "./analysis/sceneSignals.js";
import { drawNeutralPreview } from "./render/neutralPreview.js";
import { drawStyledPlan } from "./render/actionRenderer.js";
import { resetTrail } from "./render/actions/trail.js";
import { resetFrozenBoxes } from "./render/actions/freezeBox.js";
import { PRESETS, findPreset } from "./llm/defaultPlans.js";
import { requestActionPlan } from "./llm/planClient.js";
import {
  SUPPORTED_ACTIONS,
  SUPPORTED_BLEND_MODES,
  SUPPORTED_LABEL_MODES,
} from "./llm/actionPlanSchema.js";

const video = document.getElementById("video");
const outputCanvas = document.getElementById("output");
const outputCtx = outputCanvas.getContext("2d");

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

const ui = {
  fps: document.getElementById("fps"),
  status: document.getElementById("status"),
  countBadge: document.getElementById("countBadge"),
  planTitle: document.getElementById("planTitle"),
  presetRow: document.getElementById("presetRow"),
  intensitySlider: document.getElementById("intensitySlider"),
  intensityValue: document.getElementById("intensityValue"),
  promptForm: document.getElementById("promptForm"),
  promptInput: document.getElementById("promptInput"),
  promptSubmit: document.getElementById("promptSubmit"),
  promptStatus: document.getElementById("promptStatus"),
  boot: document.getElementById("boot"),
  bootStep: document.getElementById("bootStep"),
  bootBar: document.getElementById("bootBar"),
  inspectorToggle: document.getElementById("inspectorToggle"),
  inspector: document.getElementById("inspector"),
  inspectorClose: document.getElementById("inspectorClose"),
  inspectorCopy: document.getElementById("inspectorCopy"),
  inspectorSource: document.getElementById("inspectorSource"),
  inspectorMeta: document.getElementById("inspectorMeta"),
  inspectorJson: document.getElementById("inspectorJson"),
  feedToggle: document.getElementById("feedToggle"),
};

const state = {
  detector: null,
  tracker: createTracker(),
  objects: [],
  geometries: new Map(),
  foregroundBackground: null,
  sceneSignals: null,

  // Active plan resolution.
  presetId: "neutral",
  currentPlan: null,
  currentPlanSource: "preset", // "preset" | "llm" | "mock"

  // Prompt flow.
  promptPending: false,
  lastPlanError: null,
  lastPlanWarnings: [],
  inspectorOpen: false,
  hideFeed: false,

  // Intensity smoothing.
  targetIntensity: 0.8,
  currentIntensity: 0.8,
  presetSwitchAt: 0,

  fpsAcc: { last: performance.now(), frames: 0 },
};

const INTENSITY_SMOOTHING = 0.12;
const PRESET_DUCK_MS = 220;

function setStatus(text, ready = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("is-ready", ready);
}

function setBootStep(text, pct) {
  ui.bootStep.textContent = text;
  if (typeof pct === "number") ui.bootBar.style.width = `${pct}%`;
}

function hideBoot() {
  ui.boot.classList.add("is-hidden");
}

function setPromptStatus(text, kind) {
  ui.promptStatus.textContent = text || "";
  ui.promptStatus.classList.remove("is-ok", "is-mock", "is-err");
  if (kind) ui.promptStatus.classList.add(`is-${kind}`);
}

async function setupCamera() {
  setBootStep("requesting camera…", 10);
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play();
  sizeCanvases();
  setBootStep("camera ready", 40);
}

function sizeCanvases() {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  const resized =
    outputCanvas.width !== w ||
    outputCanvas.height !== h ||
    captureCanvas.width !== w ||
    captureCanvas.height !== h;
  outputCanvas.width = w;
  outputCanvas.height = h;
  captureCanvas.width = w;
  captureCanvas.height = h;
  if (resized) {
    // Held crops and the MOG2 background model are sized to the previous
    // frame — bail out so the next frame rebuilds them at the new size.
    resetFrozenBoxes();
    resetForegroundBackgroundModel();
  }
}

function captureFrame() {
  const w = captureCanvas.width;
  const h = captureCanvas.height;
  captureCtx.save();
  captureCtx.setTransform(-1, 0, 0, 1, w, 0);
  captureCtx.drawImage(video, 0, 0, w, h);
  captureCtx.restore();
}

function updateCountBadge(objects) {
  const live = objects.filter((o) => !o.stale).length;
  ui.countBadge.textContent = `${live} ${live === 1 ? "object" : "objects"}`;
}

function tickFps(now) {
  state.fpsAcc.frames += 1;
  const elapsed = now - state.fpsAcc.last;
  if (elapsed >= 500) {
    const fps = (state.fpsAcc.frames * 1000) / elapsed;
    ui.fps.textContent = `${fps.toFixed(0)} fps`;
    state.fpsAcc.frames = 0;
    state.fpsAcc.last = now;
  }
}

function isLlmSource(source) {
  return source === "llm" || source === "mock";
}

function activePlan() {
  if (isLlmSource(state.currentPlanSource) && state.currentPlan) return state.currentPlan;
  return findPreset(state.presetId).plan;
}

function activePlanTitle() {
  if (isLlmSource(state.currentPlanSource) && state.currentPlan) return state.currentPlan.title;
  const p = findPreset(state.presetId);
  return p.plan ? p.plan.title : p.title;
}

function firstActionOfType(plan, type) {
  for (const rule of plan?.objectRules || []) {
    for (const action of rule.actions || []) {
      if (action.type === type) return action;
    }
  }
  return null;
}

// MOG2 needs to run whenever the active plan asks for the foreground mask —
// either directly via `foregroundBackground`, or indirectly via a `localDepth`
// with `onlyForeground` set so it can clip its colormap to the silhouette.
// Prefer the foregroundBackground action's learningRate when present.
function planForegroundMaskNeed(plan) {
  let needed = false;
  let learningRate = 0.04;
  for (const rule of plan?.objectRules || []) {
    for (const action of rule.actions || []) {
      if (action.type === "foregroundBackground") {
        needed = true;
        learningRate = action.learningRate;
      } else if (action.type === "localDepth" && action.onlyForeground > 0.5) {
        needed = true;
      }
    }
  }
  return { needed, learningRate };
}

function refreshPlanTitle() {
  ui.planTitle.textContent = activePlanTitle();
}

function setPresetSelection(id) {
  for (const btn of ui.presetRow.children) {
    const isActive = state.currentPlanSource === "preset" && btn.dataset.preset === id;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  }
}

function effectiveTargetIntensity(now) {
  const dt = now - state.presetSwitchAt;
  if (dt < PRESET_DUCK_MS) return 0;
  return state.targetIntensity;
}

function updateIntensitySliderFill(value) {
  ui.intensitySlider.style.setProperty("--fill", `${value * 100}%`);
  ui.intensityValue.textContent = String(Math.round(value * 100));
}

function announcePlanSwitch() {
  state.presetSwitchAt = performance.now();
  resetTrail();
  resetForegroundBackgroundModel();
  resetFrozenBoxes();
}

function selectPreset(id) {
  const preset = findPreset(id);
  state.presetId = preset.id;
  state.currentPlanSource = "preset";
  state.currentPlan = null;
  state.lastPlanError = null;
  state.lastPlanWarnings = [];
  setPromptStatus("", null);
  announcePlanSwitch();
  refreshPlanTitle();
  setPresetSelection(preset.id);
  refreshInspector();
}

function applyLlmPlan(plan, source, warnings) {
  state.currentPlan = plan;
  state.currentPlanSource = source === "mock" ? "mock" : "llm";
  state.lastPlanError = null;
  state.lastPlanWarnings = warnings || [];
  announcePlanSwitch();
  refreshPlanTitle();
  setPresetSelection(null);
  if (source === "mock") {
    setPromptStatus("mock", "mock");
  } else {
    setPromptStatus("applied", "ok");
  }
  if (warnings && warnings.length > 0) {
    console.warn("[plan] warnings:", warnings);
  }
  refreshInspector();
}

const INSPECTOR_SOURCE_LABEL = {
  preset: "preset",
  llm: "llm",
  mock: "mock",
};

function refreshInspector() {
  const plan = activePlan();
  ui.inspectorJson.textContent = plan ? JSON.stringify(plan, null, 2) : "{}";

  const source = state.currentPlanSource;
  ui.inspectorSource.textContent = INSPECTOR_SOURCE_LABEL[source] || source;
  ui.inspectorSource.className = `inspector__source is-${source}`;

  ui.inspectorMeta.replaceChildren();
  if (state.lastPlanError) {
    const span = document.createElement("span");
    span.className = "err";
    span.textContent = `error: ${state.lastPlanError}`;
    ui.inspectorMeta.appendChild(span);
  }
  if (state.lastPlanWarnings && state.lastPlanWarnings.length > 0) {
    if (ui.inspectorMeta.childNodes.length > 0) {
      ui.inspectorMeta.appendChild(document.createElement("br"));
    }
    const span = document.createElement("span");
    span.className = "warn";
    span.textContent = `warnings: ${state.lastPlanWarnings.join(", ")}`;
    ui.inspectorMeta.appendChild(span);
  }
  if (ui.inspectorMeta.childNodes.length === 0) {
    ui.inspectorMeta.textContent = "—";
  }
}

async function copyInspectorJson() {
  const text = ui.inspectorJson.textContent || "{}";
  let copied = false;
  try {
    // navigator.clipboard requires a secure context — falls through to the
    // execCommand path on plain http://localhost dev sessions.
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand("copy");
      document.body.removeChild(ta);
    }
  } catch (err) {
    console.warn("[inspector] copy failed:", err);
  }

  const label = ui.inspectorCopy;
  label.textContent = copied ? "copied" : "failed";
  label.classList.toggle("is-copied", copied);
  setTimeout(() => {
    label.textContent = "copy";
    label.classList.remove("is-copied");
  }, 1200);
}

function setInspectorOpen(open) {
  state.inspectorOpen = open;
  ui.inspector.classList.toggle("is-open", open);
  ui.inspector.setAttribute("aria-hidden", open ? "false" : "true");
  ui.inspectorToggle.classList.toggle("is-active", open);
  ui.inspectorToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) refreshInspector();
}

function setHideFeed(hide) {
  state.hideFeed = hide;
  ui.feedToggle.classList.toggle("is-active", hide);
  ui.feedToggle.setAttribute("aria-pressed", hide ? "true" : "false");
}

async function submitPrompt() {
  if (state.promptPending) return;
  const text = ui.promptInput.value.trim();
  if (!text) return;

  state.promptPending = true;
  ui.promptSubmit.disabled = true;
  setPromptStatus("planning…", null);

  const detectedClasses = state.sceneSignals?.classes || [];
  const payload = {
    userPrompt: text,
    detectedClasses,
    signals: state.sceneSignals || {},
    currentPlan: state.currentPlan
      ? { title: state.currentPlan.title }
      : null,
    supportedActions: SUPPORTED_ACTIONS,
    supportedBlendModes: SUPPORTED_BLEND_MODES,
    supportedLabelModes: SUPPORTED_LABEL_MODES,
  };

  try {
    const { plan, source, warnings } = await requestActionPlan(payload);
    if (!plan || !plan.objectRules || plan.objectRules.length === 0) {
      throw new Error("empty_plan");
    }
    applyLlmPlan(plan, source, warnings);
  } catch (err) {
    console.error("[plan] failed:", err);
    state.lastPlanError = err.message || String(err);
    setPromptStatus("invalid", "err");
    refreshInspector();
  } finally {
    state.promptPending = false;
    ui.promptSubmit.disabled = false;
  }
}

function buildPresetUi() {
  for (const p of PRESETS) {
    const btn = document.createElement("button");
    btn.className = "preset" + (p.id === state.presetId ? " is-active" : "");
    btn.type = "button";
    btn.dataset.preset = p.id;
    btn.textContent = p.title;
    btn.setAttribute("role", "tab");
    btn.setAttribute(
      "aria-selected",
      state.currentPlanSource === "preset" && p.id === state.presetId ? "true" : "false",
    );
    btn.addEventListener("click", () => selectPreset(p.id));
    ui.presetRow.appendChild(btn);
  }
}

function wireUi() {
  buildPresetUi();
  refreshPlanTitle();

  const onSlider = () => {
    const v = Number(ui.intensitySlider.value) / 100;
    state.targetIntensity = v;
    updateIntensitySliderFill(v);
  };
  ui.intensitySlider.addEventListener("input", onSlider);
  onSlider();

  ui.promptForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitPrompt();
  });

  ui.inspectorToggle.addEventListener("click", () => setInspectorOpen(!state.inspectorOpen));
  ui.inspectorClose.addEventListener("click", () => setInspectorOpen(false));
  ui.inspectorCopy.addEventListener("click", copyInspectorJson);
  ui.feedToggle.addEventListener("click", () => setHideFeed(!state.hideFeed));

  // Keyboard shortcuts.
  window.addEventListener("keydown", (e) => {
    // Escape blurs the prompt from anywhere; also closes the inspector.
    if (e.key === "Escape" && document.activeElement === ui.promptInput) {
      ui.promptInput.blur();
      e.preventDefault();
      return;
    }
    // While the prompt is focused, don't intercept anything else.
    if (document.activeElement === ui.promptInput) return;

    if (e.key === "Escape" && state.inspectorOpen) {
      setInspectorOpen(false);
      e.preventDefault();
      return;
    }

    // "/" focuses the prompt input.
    if (e.key === "/") {
      e.preventDefault();
      ui.promptInput.focus();
      ui.promptInput.select();
      return;
    }

    // "i" toggles the inspector.
    if (e.key === "i" || e.key === "I") {
      e.preventDefault();
      setInspectorOpen(!state.inspectorOpen);
      return;
    }

    // "c" toggles the camera feed.
    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      setHideFeed(!state.hideFeed);
      return;
    }

    // 1..N picks presets.
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= PRESETS.length) {
      selectPreset(PRESETS[n - 1].id);
    }
  });

  refreshInspector();
}

async function loop() {
  const now = performance.now();
  if (video.readyState >= 2 && state.detector) {
    captureFrame();
    try {
      const raw = await detect(state.detector, captureCanvas);
      state.objects = state.tracker.update(raw, {
        canvasWidth: captureCanvas.width,
        canvasHeight: captureCanvas.height,
        now,
      });
      state.sceneSignals = computeSceneSignals(state.objects);
      const plan = activePlan();
      const needsDepth = !!firstActionOfType(plan, "localDepth");
      state.geometries = isCvReady()
        ? computeObjectGeometry(captureCanvas, state.objects, { includeDepth: needsDepth })
        : new Map();
      const fgNeed = planForegroundMaskNeed(plan);
      state.foregroundBackground = fgNeed.needed && isForegroundBackgroundReady()
        ? computeForegroundBackground(captureCanvas, { learningRate: fgNeed.learningRate })
        : null;

      const target = effectiveTargetIntensity(now);
      state.currentIntensity += (target - state.currentIntensity) * INTENSITY_SMOOTHING;
      if (state.currentIntensity < 0.001) state.currentIntensity = 0;

      if (plan && state.currentIntensity > 0.01) {
        drawStyledPlan(
          outputCtx,
          captureCanvas,
          state.objects,
          state.geometries,
          plan,
          {
            intensity: state.currentIntensity,
            timeMs: now,
            hideFeed: state.hideFeed,
            foregroundBackground: state.foregroundBackground,
          },
        );
      } else {
        drawNeutralPreview(outputCtx, captureCanvas, state.objects, state.geometries, { hideFeed: state.hideFeed });
      }

      updateCountBadge(state.objects);
    } catch (err) {
      console.error("[loop] error:", err);
    }
  }
  tickFps(now);
  requestAnimationFrame(loop);
}

async function main() {
  try {
    wireUi();
    await setupCamera();
    setBootStep("loading detector…", 60);
    state.detector = await loadDetector();
    setBootStep("ready", 100);
    setStatus("ready", true);
    hideBoot();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setBootStep(`error: ${err.message || err}`, 100);
    setStatus("error");
  }
}

main();
