/*
 * Depth mode — stylized pseudo-depth from luminance + edge-preserving smoothing.
 *
 * This is NOT a real monocular depth estimator (no MiDaS / DPT in the browser).
 * It produces a depth-LOOKING visual by:
 *   1) grayscale luminance
 *   2) bilateral filter — flattens flat surfaces while keeping silhouettes crisp
 *   3) histogram equalization — pushes apparent dynamic range
 *   4) inferno colormap — bright = "near", dark = "far"
 *
 * For typical webcam framing (lit subject in front of dimmer background) this
 * happens to approximate a depth map closely enough to feel right.
 */

export const DepthMode = {
  id: "depth",
  label: "Depth",
  _tmp: null,

  async init({ outputCanvas }) {
    this._tmp = document.createElement("canvas");
    this._tmp.width = outputCanvas.width;
    this._tmp.height = outputCanvas.height;
  },

  process({ captureCanvas, outputCanvas, outputCtx }) {
    const cv = window.cv;
    const w = captureCanvas.width;
    const h = captureCanvas.height;

    if (this._tmp.width !== w || this._tmp.height !== h) {
      this._tmp.width = w;
      this._tmp.height = h;
    }

    const src = cv.imread(captureCanvas);
    const rgb = new cv.Mat();
    const gray = new cv.Mat();
    const smoothed = new cv.Mat();
    const equalized = new cv.Mat();
    const colored = new cv.Mat();

    try {
      // Bilateral filter expects 1 or 3 channel — RGBA is 4, so convert.
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
      // d=9 keeps it fast; sigma values control how aggressively flat regions merge.
      cv.bilateralFilter(gray, smoothed, 9, 60, 60, cv.BORDER_DEFAULT);
      cv.equalizeHist(smoothed, equalized);
      cv.applyColorMap(equalized, colored, cv.COLORMAP_INFERNO);
      // applyColorMap returns BGR; canvas needs RGBA.
      cv.cvtColor(colored, colored, cv.COLOR_BGR2RGBA);

      cv.imshow(this._tmp, colored);

      outputCtx.save();
      outputCtx.setTransform(1, 0, 0, 1, 0, 0);
      outputCtx.drawImage(this._tmp, 0, 0);
      // Subtle vignette to push focus to the center.
      const grd = outputCtx.createRadialGradient(
        w / 2, h / 2, Math.min(w, h) * 0.35,
        w / 2, h / 2, Math.max(w, h) * 0.75,
      );
      grd.addColorStop(0, "rgba(0,0,0,0)");
      grd.addColorStop(1, "rgba(0,0,0,0.5)");
      outputCtx.fillStyle = grd;
      outputCtx.fillRect(0, 0, w, h);
      outputCtx.restore();
    } finally {
      src.delete();
      rgb.delete();
      gray.delete();
      smoothed.delete();
      equalized.delete();
      colored.delete();
    }
  },

  dispose() {},
};
