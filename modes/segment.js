/*
 * Segment mode — MediaPipe Selfie Segmentation overlay.
 *
 * The model returns a soft mask (canvas/ImageBitmap) where bright pixels are
 * the foreground person. We composite the camera as a dimmed background, then
 * draw the full-color foreground (camera × mask) over it, plus a thin accent
 * tint so the cutout reads as an effect rather than just a vignette.
 *
 * MediaPipe runs asynchronously — onResults fires whenever the next mask is
 * ready. We never block the render loop on send(); each frame either uses the
 * most recent mask or skips the overlay if no result has arrived yet.
 */

export const SegmentMode = {
  id: "segment",
  label: "Segment",
  _seg: null,
  _lastResults: null,
  _inFlight: false,
  _fg: null,
  _tint: null,

  async init({ outputCanvas }) {
    if (!window.SelfieSegmentation) throw new Error("selfie segmentation library missing");
    if (!this._seg) {
      this._seg = new window.SelfieSegmentation({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/${file}`,
      });
      // modelSelection: 1 = landscape (general purpose, better for whole-body framing).
      this._seg.setOptions({ modelSelection: 1, selfieMode: false });
      this._seg.onResults((results) => {
        this._lastResults = results;
      });
      // Force model initialization by sending an initial 1x1 dummy frame.
      // (initialize() exists on some builds but isn't guaranteed.)
      try {
        if (typeof this._seg.initialize === "function") {
          await this._seg.initialize();
        }
      } catch (e) {
        // Non-fatal — first send() will still load the model.
        console.warn("[segment] initialize() not available, will lazy-init", e);
      }
    }
    this._fg = document.createElement("canvas");
    this._fg.width = outputCanvas.width;
    this._fg.height = outputCanvas.height;
  },

  process({ captureCanvas, outputCanvas, outputCtx }) {
    const w = outputCanvas.width;
    const h = outputCanvas.height;

    if (this._fg.width !== w || this._fg.height !== h) {
      this._fg.width = w;
      this._fg.height = h;
    }

    // Kick off the next mask without awaiting (avoid blocking the loop).
    if (!this._inFlight) {
      this._inFlight = true;
      this._seg
        .send({ image: captureCanvas })
        .catch((err) => console.error("[segment] send failed:", err))
        .finally(() => {
          this._inFlight = false;
        });
    }

    outputCtx.save();
    outputCtx.setTransform(-1, 0, 0, 1, w, 0);

    // Dimmed background.
    outputCtx.drawImage(captureCanvas, 0, 0);
    outputCtx.fillStyle = "rgba(6, 8, 12, 0.62)";
    outputCtx.fillRect(0, 0, w, h);

    const mask = this._lastResults && this._lastResults.segmentationMask;
    if (mask) {
      // Build foreground = mask × camera in an offscreen, then draw over the dim layer.
      const fctx = this._fg.getContext("2d");
      fctx.save();
      fctx.globalCompositeOperation = "source-over";
      fctx.clearRect(0, 0, w, h);
      fctx.drawImage(mask, 0, 0, w, h);
      fctx.globalCompositeOperation = "source-in";
      fctx.drawImage(captureCanvas, 0, 0, w, h);
      // Accent tint, kept subtle so the camera color still reads.
      fctx.globalCompositeOperation = "source-atop";
      fctx.fillStyle = "rgba(126, 240, 197, 0.22)";
      fctx.fillRect(0, 0, w, h);
      fctx.restore();

      outputCtx.drawImage(this._fg, 0, 0);
    }

    outputCtx.restore();
  },

  dispose() {},
};
