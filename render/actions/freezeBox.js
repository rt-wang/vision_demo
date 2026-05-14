/*
 * Freeze-box action — pin object crops as persistent memory tiles.
 *
 * Each matched object gets its own offscreen canvas the size of the crop at
 * first capture. Subsequent frames blend the live crop in at alpha=decay so
 * decay=0 holds the original frame indefinitely and decay=1 effectively
 * refreshes every frame. The renderer then draws the held canvas at the
 * object's current bbox with optional jitter / reframe / blend.
 *
 * State lives across frames keyed by object id. Reset hooks:
 *   - resetFrozenBoxes()        — wipe everything (plan change, camera resize)
 *   - pruneFrozenBoxes(liveIds) — drop entries for objects no longer present
 */

import { blendMode as resolveBlend } from "../../llm/actionPlanSchema.js";

const _frozen = new Map(); // objectId -> { canvas, ctx, width, height }
const _blendScratch = document.createElement("canvas");
const _blendScratchCtx = _blendScratch.getContext("2d");

function ensureScratch(w, h) {
  if (_blendScratch.width !== w) _blendScratch.width = w;
  if (_blendScratch.height !== h) _blendScratch.height = h;
}

function captureCrop(captureCanvas, sx, sy, sw, sh) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, sw);
  canvas.height = Math.max(1, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(captureCanvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx, width: canvas.width, height: canvas.height };
}

function blendLiveIntoFrozen(entry, captureCanvas, sx, sy, sw, sh, decay) {
  if (decay <= 0.001) return;
  ensureScratch(entry.width, entry.height);
  _blendScratchCtx.save();
  _blendScratchCtx.globalCompositeOperation = "source-over";
  _blendScratchCtx.clearRect(0, 0, entry.width, entry.height);
  _blendScratchCtx.drawImage(
    captureCanvas,
    sx, sy, sw, sh,
    0, 0, entry.width, entry.height,
  );
  _blendScratchCtx.restore();

  entry.ctx.save();
  entry.ctx.globalAlpha = Math.min(1, decay);
  entry.ctx.globalCompositeOperation = "source-over";
  entry.ctx.drawImage(_blendScratch, 0, 0);
  entry.ctx.restore();
}

export function resetFrozenBoxes() {
  _frozen.clear();
}

export function pruneFrozenBoxes(liveIds) {
  if (_frozen.size === 0) return;
  const keep = new Set(liveIds);
  for (const id of [..._frozen.keys()]) {
    if (!keep.has(id)) _frozen.delete(id);
  }
}

export function applyFreezeBox(ctx, { object, action, intensity, captureCanvas, timeMs }) {
  const [bx, by, bw, bh] = object.bbox;
  const sx = Math.max(0, Math.floor(bx));
  const sy = Math.max(0, Math.floor(by));
  const sw = Math.max(1, Math.floor(bw));
  const sh = Math.max(1, Math.floor(bh));

  let entry = _frozen.get(object.id);
  if (!entry || entry.width !== sw || entry.height !== sh) {
    // First sighting (or the bbox changed size enough that the held crop no
    // longer matches): grab a fresh capture and reset the held canvas.
    entry = captureCrop(captureCanvas, sx, sy, sw, sh);
    _frozen.set(object.id, entry);
  } else {
    blendLiveIntoFrozen(entry, captureCanvas, sx, sy, sw, sh, action.decay);
  }

  // Reframe expands/contracts the drawn crop around the bbox center. Keep the
  // range modest so a value of 1 doesn't blow the frame.
  const scale = 1 + (action.reframe - 0) * 0.6;
  const dw = sw * scale;
  const dh = sh * scale;
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;

  // Jitter: small per-frame offset driven by time so it reads as live shake
  // rather than random scatter.
  const jitterPx = action.jitter * Math.max(sw, sh) * 0.08;
  const jx = jitterPx > 0 ? Math.sin(timeMs * 0.013 + object.id.length) * jitterPx : 0;
  const jy = jitterPx > 0 ? Math.cos(timeMs * 0.011 + object.id.length) * jitterPx : 0;

  ctx.save();
  ctx.globalAlpha = action.opacity * intensity;
  ctx.globalCompositeOperation = resolveBlend(action.blendMode);
  ctx.drawImage(entry.canvas, cx - dw / 2 + jx, cy - dh / 2 + jy, dw, dh);
  ctx.restore();
}
