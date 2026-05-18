/*
 * Scene-level Canny edge mask (Phase 5).
 *
 * Produces a full-frame edge mask canvas suitable for WebGL upload. This is
 * distinct from analysis/objectLocalCv.js, which runs Canny inside per-object
 * crops. Phase 5 shaders want one stable RGBA canvas the GPU can sample as
 * `u_edgeMask`.
 *
 * Returns a persistent canvas; callers should treat it as read-only. The
 * canvas is reused across frames at the capture canvas size.
 */

let _src = null;
let _gray = null;
let _edges = null;
let _width = 0;
let _height = 0;

let _maskCanvas = null;
let _maskCtx = null;

function disposeMat(m) {
  if (m && !m.isDeleted?.()) {
    try { m.delete(); } catch (_) { /* ignore */ }
  }
}

export function disposeSceneEdgeMaskMats() {
  disposeMat(_src); _src = null;
  disposeMat(_gray); _gray = null;
  disposeMat(_edges); _edges = null;
  _width = 0;
  _height = 0;
  _maskCanvas = null;
  _maskCtx = null;
}

export function isReady() {
  return !!(window.cv && window.cv.Mat && window.cv.Canny);
}

export function getSceneEdgeMaskCanvas() {
  return _maskCanvas;
}

function ensureState(cv, width, height) {
  const resized = width !== _width || height !== _height;
  if (resized) {
    disposeMat(_gray); _gray = null;
    disposeMat(_edges); _edges = null;
    _maskCanvas = null;
    _maskCtx = null;
    _width = width;
    _height = height;
  }
  if (!_gray) _gray = new cv.Mat();
  if (!_edges) _edges = new cv.Mat();
  if (!_maskCanvas) {
    _maskCanvas = document.createElement("canvas");
    _maskCanvas.width = width;
    _maskCanvas.height = height;
    _maskCtx = _maskCanvas.getContext("2d");
  }
}

function edgeMatToImageData(mat) {
  // Encode the edge value in RGB with alpha=255 so canvas→WebGL upload
  // preserves the value (no premultiplied-alpha collapse). Shaders read the
  // edge via .r; drawImage'ing this canvas as a debug overlay shows the raw
  // grayscale edge map.
  const w = mat.cols;
  const h = mat.rows;
  const src = mat.data;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = src[i];
    const o = i * 4;
    out[o] = v;
    out[o + 1] = v;
    out[o + 2] = v;
    out[o + 3] = 255;
  }
  return new ImageData(out, w, h);
}

export function computeSceneEdgeMask(captureCanvas, options = {}) {
  const cv = window.cv;
  if (!isReady()) return null;

  const width = captureCanvas.width;
  const height = captureCanvas.height;
  if (width <= 0 || height <= 0) return null;

  ensureState(cv, width, height);

  disposeMat(_src);
  _src = cv.imread(captureCanvas);

  cv.cvtColor(_src, _gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(_gray, _gray, new cv.Size(5, 5), 1.4, 1.4, cv.BORDER_DEFAULT);

  const lo = Number.isFinite(options.lowThreshold) ? options.lowThreshold : 60;
  const hi = Number.isFinite(options.highThreshold) ? options.highThreshold : 150;
  cv.Canny(_gray, _edges, lo, hi, 3, false);

  const imageData = edgeMatToImageData(_edges);
  if (_maskCtx) {
    _maskCtx.putImageData(imageData, 0, 0);
  }
  return {
    edgeMask: imageData,
    edgeMaskCanvas: _maskCanvas,
  };
}
