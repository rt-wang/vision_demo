/*
 * Lines mode — Canny edges + probabilistic Hough Lines on every frame.
 *
 * Per-frame pipeline (all on captureCanvas, which is the un-mirrored video):
 *   src (RGBA) → gray → Gaussian blur → Canny → HoughLinesP → list of segments
 *
 * The capture buffer and the line segments are in the same coordinate space,
 * so we can draw them directly onto the output canvas with no extra transform.
 */

export const LinesMode = {
  id: "lines",
  label: "Lines",

  async init() {
    // Nothing to load — OpenCV is already initialized by the host before init runs.
  },

  process({ captureCanvas, outputCanvas, outputCtx }) {
    const cv = window.cv;
    const w = captureCanvas.width;
    const h = captureCanvas.height;

    const src = cv.imread(captureCanvas);
    const gray = new cv.Mat();
    const edges = new cv.Mat();
    const lines = new cv.Mat();

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      // Light blur tames sensor noise so Canny doesn't pick up speckle.
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 1.4, 1.4, cv.BORDER_DEFAULT);
      cv.Canny(gray, edges, 60, 150, 3, false);
      // Probabilistic Hough gives line segments (with endpoints) instead of
      // infinite (rho, theta) lines — much easier to draw as creative strokes.
      cv.HoughLinesP(
        edges,
        lines,
        1, // rho px resolution
        Math.PI / 180, // theta resolution
        60, // accumulator threshold (votes)
        40, // minLineLength
        12, // maxLineGap
      );

      // Compose output: dimmed source + glowing line segments.
      outputCtx.save();
      outputCtx.setTransform(1, 0, 0, 1, 0, 0);
      outputCtx.drawImage(captureCanvas, 0, 0);
      outputCtx.fillStyle = "rgba(6, 8, 12, 0.55)";
      outputCtx.fillRect(0, 0, w, h);

      outputCtx.lineCap = "round";
      outputCtx.lineWidth = Math.max(2, w * 0.0028);
      outputCtx.strokeStyle = "rgba(126, 240, 197, 0.95)";
      outputCtx.shadowBlur = 14;
      outputCtx.shadowColor = "rgba(126, 240, 197, 0.55)";

      const data = lines.data32S;
      for (let i = 0; i < lines.rows; i++) {
        const x1 = data[i * 4];
        const y1 = data[i * 4 + 1];
        const x2 = data[i * 4 + 2];
        const y2 = data[i * 4 + 3];
        outputCtx.beginPath();
        outputCtx.moveTo(x1, y1);
        outputCtx.lineTo(x2, y2);
        outputCtx.stroke();
      }
      outputCtx.restore();
    } finally {
      src.delete();
      gray.delete();
      edges.delete();
      lines.delete();
    }
  },

  dispose() {},
};
