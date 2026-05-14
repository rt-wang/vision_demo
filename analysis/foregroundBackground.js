/*
 * Foreground/background analysis (Phase 4B).
 *
 * OpenCV.js exposes MOG2 as `new cv.BackgroundSubtractorMOG2(...)`.
 * Keep the subtractor instance alive across frames so it can learn the static
 * background, and delete it explicitly when reset/disposed.
 */

let _src = null;
let _fgmask = null;
let _clean = null;
let _kernel = null;
let _subtractor = null;
let _width = 0;
let _height = 0;
let _warnedUnavailable = false;

function disposeMat(m) {
  if (m && !m.isDeleted?.()) {
    try { m.delete(); } catch (_) { /* ignore */ }
  }
}

function disposeSubtractor() {
  if (_subtractor && !_subtractor.isDeleted?.()) {
    try { _subtractor.delete(); } catch (_) { /* ignore */ }
  }
  _subtractor = null;
}

export function resetForegroundBackgroundModel() {
  disposeSubtractor();
}

export function disposeForegroundBackgroundMats() {
  disposeMat(_src); _src = null;
  disposeMat(_fgmask); _fgmask = null;
  disposeMat(_clean); _clean = null;
  disposeMat(_kernel); _kernel = null;
  disposeSubtractor();
  _width = 0;
  _height = 0;
}

export function isReady() {
  return !!(window.cv && window.cv.Mat && window.cv.BackgroundSubtractorMOG2);
}

function ensureState(cv, width, height) {
  const resized = width !== _width || height !== _height;
  if (resized) {
    disposeMat(_fgmask); _fgmask = null;
    disposeMat(_clean); _clean = null;
    disposeSubtractor();
    _width = width;
    _height = height;
  }

  if (!_fgmask) _fgmask = new cv.Mat(height, width, cv.CV_8UC1);
  if (!_clean) _clean = new cv.Mat();
  if (!_kernel) {
    _kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
  }
  if (!_subtractor) {
    _subtractor = new cv.BackgroundSubtractorMOG2(500, 16, false);
  }
}

function maskMatToImageData(mat) {
  const w = mat.cols;
  const h = mat.rows;
  const src = mat.data;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = src[i];
    const o = i * 4;
    out[o] = 255;
    out[o + 1] = 255;
    out[o + 2] = 255;
    out[o + 3] = v;
  }
  return new ImageData(out, w, h);
}

function learningRateFromOptions(options) {
  const lr = Number(options?.learningRate);
  if (!Number.isFinite(lr)) return -1;
  return Math.max(0, Math.min(1, lr));
}

export function computeForegroundBackground(captureCanvas, options = {}) {
  const cv = window.cv;
  if (!isReady()) {
    if (!_warnedUnavailable && cv && cv.Mat) {
      console.warn("[foregroundBackground] cv.BackgroundSubtractorMOG2 is unavailable in this OpenCV.js build");
      _warnedUnavailable = true;
    }
    return null;
  }

  const width = captureCanvas.width;
  const height = captureCanvas.height;
  if (width <= 0 || height <= 0) return null;

  ensureState(cv, width, height);

  disposeMat(_src);
  _src = cv.imread(captureCanvas);

  _subtractor.apply(_src, _fgmask, learningRateFromOptions(options));

  // MOG2 returns an 8-bit mask. Threshold defensively and apply a small open
  // then close pass to reduce camera noise without erasing useful silhouettes.
  cv.threshold(_fgmask, _fgmask, 127, 255, cv.THRESH_BINARY);
  cv.morphologyEx(_fgmask, _clean, cv.MORPH_OPEN, _kernel);
  cv.morphologyEx(_clean, _clean, cv.MORPH_CLOSE, _kernel);

  return {
    foregroundMask: maskMatToImageData(_clean),
  };
}
