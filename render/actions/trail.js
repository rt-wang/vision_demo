/*
 * Trail action — persistent decaying motion smear over object regions.
 *
 * Uses a pooled offscreen canvas that survives across frames. Each frame the
 * orchestrator calls fadeTrailCanvas() once to attenuate the existing content,
 * then paintObjectIntoTrail() per object that has a trail action to deposit
 * fresh pixels, then compositeTrail() once to blit the layer onto the output.
 *
 * Trail length is the per-frame retention factor: higher `length` ⇒ slower
 * fade ⇒ longer smear. `smear` adds a small gaussian-ish blur via shadowBlur
 * when depositing so the smear softens with each frame.
 *
 * When a MOG2 foreground mask is provided, the deposit is clipped to the body
 * silhouette before stamping into the trail canvas — so the smear traces the
 * moving body rather than a moving rectangle, and the shadow halo follows the
 * silhouette outline instead of bbox edges. Falls back to full-bbox deposit
 * when the mask isn't available (MOG2 warm-up, or plan opts out).
 */

let _trail = null;
let _trailCtx = null;
let _lastFadeFrame = -1;

// Scratch surface for masking a bbox crop down to its silhouette before
// depositing into the trail canvas. Sized per call to the bbox dimensions.
const _scratch = document.createElement("canvas");
const _scratchCtx = _scratch.getContext("2d");

// Cached upload of the MOG2 foreground mask. The ImageData identity is stable
// for a frame, so trail + localDepth + foregroundBackground share one upload.
const _maskCanvas = document.createElement("canvas");
const _maskCtx = _maskCanvas.getContext("2d");
let _maskRevision = null;

function ensure(w, h) {
  if (!_trail) {
    _trail = document.createElement("canvas");
    _trailCtx = _trail.getContext("2d");
  }
  if (_trail.width !== w) _trail.width = w;
  if (_trail.height !== h) _trail.height = h;
}

function ensureScratch(w, h) {
  if (_scratch.width !== w) _scratch.width = w;
  if (_scratch.height !== h) _scratch.height = h;
}

function ensureMaskCanvas(mask) {
  if (_maskRevision === mask) return;
  if (_maskCanvas.width !== mask.width) _maskCanvas.width = mask.width;
  if (_maskCanvas.height !== mask.height) _maskCanvas.height = mask.height;
  _maskCtx.putImageData(mask, 0, 0);
  _maskRevision = mask;
}

export function resetTrail() {
  if (_trailCtx) _trailCtx.clearRect(0, 0, _trail.width, _trail.height);
}

export function fadeTrailCanvas(w, h, length) {
  ensure(w, h);
  // Map length 0..1 to a per-frame keep-factor:
  //   length=0   ⇒ keep≈0     (immediate clear, no trail)
  //   length=1   ⇒ keep≈0.97  (very long trail)
  const keep = Math.max(0, Math.min(0.97, length * 0.97));
  const fadeAlpha = 1 - keep;
  _trailCtx.save();
  _trailCtx.globalCompositeOperation = "destination-out";
  _trailCtx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
  _trailCtx.fillRect(0, 0, w, h);
  _trailCtx.restore();
}

export function paintObjectIntoTrail(object, captureCanvas, smear, foregroundMask) {
  if (!_trailCtx) return;
  const [x, y, bw, bh] = object.bbox;
  if (bw < 1 || bh < 1) return;
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.max(1, Math.floor(bw));
  const sh = Math.max(1, Math.floor(bh));

  if (foregroundMask) {
    // Build the silhouette-shaped deposit on the scratch canvas, then stamp it
    // into the trail. `copy` first writes the bbox crop, `destination-in` then
    // keeps only pixels overlapping the MOG2 silhouette — leaving transparency
    // outside the body so the shadow halo (if any) traces the body outline.
    ensureScratch(sw, sh);
    ensureMaskCanvas(foregroundMask);
    _scratchCtx.save();
    _scratchCtx.globalCompositeOperation = "copy";
    _scratchCtx.drawImage(captureCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    _scratchCtx.globalCompositeOperation = "destination-in";
    _scratchCtx.drawImage(_maskCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    _scratchCtx.restore();

    _trailCtx.save();
    if (smear > 0) {
      _trailCtx.shadowBlur = smear * 18;
      _trailCtx.shadowColor = "rgba(255,255,255,0.6)";
    }
    _trailCtx.drawImage(_scratch, 0, 0, sw, sh, sx, sy, sw, sh);
    _trailCtx.restore();
    return;
  }

  _trailCtx.save();
  if (smear > 0) {
    _trailCtx.shadowBlur = smear * 18;
    _trailCtx.shadowColor = "rgba(255,255,255,0.6)";
  }
  _trailCtx.drawImage(captureCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
  _trailCtx.restore();
}

export function compositeTrail(ctx, opacity) {
  if (!_trail) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(_trail, 0, 0);
  ctx.restore();
}
