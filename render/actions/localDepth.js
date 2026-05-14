/*
 * Local depth action — colormap a normalized grayscale depth crop.
 *
 * Analysis (objectLocalCv) outputs a single-channel Uint8 buffer per object
 * after a bilateral-filter + equalizeHist pass. The renderer maps each value
 * through a 256-entry palette LUT, optionally inverted, and blits the result
 * at the bbox origin. `relief` controls a second additive pass for a stronger
 * 3D-ish read; `glow` adds a soft halo via shadowBlur.
 *
 * Palette LUTs are precomputed once at module load. They're rough hand-tuned
 * approximations of OpenCV's matplotlib-style colormaps — close enough that
 * the LLM picking "inferno" vs "ocean" produces visibly different material.
 */

const PALETTE_LUTS = (() => {
  // Each palette is a list of stops [r, g, b] across the 0..255 range. The
  // LUT is built by linear-interpolating between consecutive stops.
  const stops = {
    inferno: [
      [0, 0, 4], [20, 11, 52], [66, 10, 104], [120, 28, 109],
      [177, 42, 90], [229, 92, 48], [251, 158, 35], [252, 254, 164],
    ],
    bone: [
      [0, 0, 0], [50, 50, 70], [110, 130, 150], [180, 200, 220], [255, 255, 255],
    ],
    ocean: [
      [0, 0, 60], [0, 30, 110], [0, 80, 160], [10, 150, 200],
      [80, 210, 220], [200, 240, 230], [255, 255, 255],
    ],
    magma: [
      [0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129],
      [181, 54, 122], [229, 80, 100], [251, 135, 97], [252, 253, 191],
    ],
  };
  const out = {};
  for (const [name, stopList] of Object.entries(stops)) {
    const lut = new Uint8ClampedArray(256 * 3);
    const segments = stopList.length - 1;
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * segments;
      const lo = Math.min(segments, Math.floor(t));
      const hi = Math.min(segments, lo + 1);
      const f = t - lo;
      const a = stopList[lo];
      const b = stopList[hi];
      lut[i * 3]     = a[0] + (b[0] - a[0]) * f;
      lut[i * 3 + 1] = a[1] + (b[1] - a[1]) * f;
      lut[i * 3 + 2] = a[2] + (b[2] - a[2]) * f;
    }
    out[name] = lut;
  }
  return out;
})();

const _depthCanvas = document.createElement("canvas");
const _depthCtx = _depthCanvas.getContext("2d");
const _maskCanvas = document.createElement("canvas");
const _maskCtx = _maskCanvas.getContext("2d");
let _maskCanvasRevision = null;

function ensureCanvas(c, w, h) {
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
}

function ensureForegroundMaskCanvas(mask) {
  // Avoid re-uploading the same mask multiple times when several objects in
  // the same frame clip against it. ImageData identity is stable for a frame.
  if (_maskCanvasRevision === mask) return;
  ensureCanvas(_maskCanvas, mask.width, mask.height);
  _maskCtx.putImageData(mask, 0, 0);
  _maskCanvasRevision = mask;
}

export function applyLocalDepth(ctx, { geometry, action, intensity, foregroundBackground }) {
  if (!geometry || !geometry.localDepth || !geometry.localDepthSize) return;
  const { width, height } = geometry.localDepthSize;
  if (width <= 0 || height <= 0) return;

  const lut = PALETTE_LUTS[action.palette] || PALETTE_LUTS.inferno;
  const invert = action.invert > 0.5;
  const src = geometry.localDepth;
  const [ox, oy] = geometry.localEdgesOrigin;

  ensureCanvas(_depthCanvas, width, height);
  const img = _depthCtx.createImageData(width, height);
  const dst = img.data;
  for (let i = 0; i < src.length; i++) {
    const v = invert ? 255 - src[i] : src[i];
    const o = i * 4;
    const li = v * 3;
    dst[o] = lut[li];
    dst[o + 1] = lut[li + 1];
    dst[o + 2] = lut[li + 2];
    dst[o + 3] = 255;
  }
  _depthCtx.putImageData(img, 0, 0);

  // onlyForeground clips the colormap to the scene-level MOG2 silhouette so
  // the depth gradient lands only on moving pixels inside the bbox. Falls
  // back to the full-bbox render when the mask isn't available yet (MOG2
  // hasn't warmed up, or the plan doesn't include foregroundBackground and
  // the depth-mask gate hasn't kicked it on).
  const fgMask = foregroundBackground?.foregroundMask;
  if (action.onlyForeground > 0.5 && fgMask) {
    ensureForegroundMaskCanvas(fgMask);
    _depthCtx.save();
    _depthCtx.globalCompositeOperation = "destination-in";
    _depthCtx.drawImage(
      _maskCanvas,
      ox, oy, width, height,
      0, 0, width, height,
    );
    _depthCtx.restore();
  }

  ctx.save();
  ctx.globalAlpha = action.opacity * intensity;
  ctx.globalCompositeOperation = "screen";
  const glow = action.glow * 26;
  if (glow > 0.5) {
    ctx.shadowBlur = glow;
    ctx.shadowColor = `rgb(${lut[128 * 3]},${lut[128 * 3 + 1]},${lut[128 * 3 + 2]})`;
  }
  ctx.drawImage(_depthCanvas, ox, oy);

  // Relief: a second pass at overlay blend amplifies the depth contour so the
  // colormap reads as material, not just a tint. Stays subtle by default.
  if (action.relief > 0.05) {
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = action.opacity * intensity * action.relief * 0.9;
    ctx.drawImage(_depthCanvas, ox, oy);
  }
  ctx.restore();
}
