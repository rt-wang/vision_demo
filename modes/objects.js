/*
 * Objects mode — COCO-SSD (TensorFlow.js) on the un-mirrored frame.
 *
 * The lite_mobilenet_v2 backbone is ~9 MB and runs comfortably in real time
 * on a laptop GPU via the WebGL backend. We run detection on every frame and
 * draw boxes on top of a mirrored copy of the source.
 *
 * Boxes are returned in source-pixel space, which matches the output canvas
 * directly — no coordinate transform needed.
 */

export const ObjectsMode = {
  id: "objects",
  label: "Objects",
  _model: null,

  async init() {
    if (this._model) return;
    if (!window.cocoSsd) throw new Error("coco-ssd library missing");
    // lite_mobilenet_v2 is the smallest variant — fastest cold start.
    this._model = await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
  },

  async process({ captureCanvas, outputCanvas, outputCtx }) {
    if (!this._model) return;
    const w = captureCanvas.width;
    const h = captureCanvas.height;

    const predictions = await this._model.detect(captureCanvas, 20, 0.5);

    outputCtx.save();
    outputCtx.setTransform(1, 0, 0, 1, 0, 0);
    outputCtx.drawImage(captureCanvas, 0, 0);
    outputCtx.restore();

    const fontSize = Math.max(14, Math.floor(w * 0.018));
    outputCtx.font = `${fontSize}px ui-monospace, Menlo, monospace`;
    outputCtx.textBaseline = "middle";
    outputCtx.lineWidth = Math.max(2, w * 0.0025);

    for (const p of predictions) {
      const [x, y, bw, bh] = p.bbox;

      outputCtx.strokeStyle = "rgba(126, 240, 197, 0.95)";
      outputCtx.shadowBlur = 12;
      outputCtx.shadowColor = "rgba(126, 240, 197, 0.55)";
      outputCtx.strokeRect(x, y, bw, bh);
      outputCtx.shadowBlur = 0;

      const label = `${p.class} · ${Math.round(p.score * 100)}%`;
      const padX = 8;
      const padY = 4;
      const m = outputCtx.measureText(label);
      const lw = m.width + padX * 2;
      const lh = fontSize + padY * 2;
      const lx = Math.max(0, x);
      const ly = Math.max(0, y - lh);

      outputCtx.fillStyle = "rgba(126, 240, 197, 0.95)";
      outputCtx.fillRect(lx, ly, lw, lh);
      outputCtx.fillStyle = "#06120e";
      outputCtx.fillText(label, lx + padX, ly + lh / 2);
    }
  },

  dispose() {},
};
