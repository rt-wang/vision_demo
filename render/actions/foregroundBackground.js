/*
 * Foreground/background action — uses a scene-level foreground mask from MOG2.
 *
 * The background pass fills the whole frame, cuts the foreground mask out, and
 * composites the result over the source. The foreground pass recolors the mask
 * and screens it back in so moving regions can read as active material.
 */

const _maskCanvas = document.createElement("canvas");
const _maskCtx = _maskCanvas.getContext("2d");
const _layerCanvas = document.createElement("canvas");
const _layerCtx = _layerCanvas.getContext("2d");

function ensureCanvas(c, width, height) {
  if (c.width !== width) c.width = width;
  if (c.height !== height) c.height = height;
}

function rgb(c) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function putMask(mask) {
  ensureCanvas(_maskCanvas, mask.width, mask.height);
  _maskCtx.save();
  _maskCtx.globalCompositeOperation = "source-over";
  _maskCtx.clearRect(0, 0, mask.width, mask.height);
  _maskCtx.putImageData(mask, 0, 0);
  _maskCtx.restore();
}

export function applyForegroundBackground(ctx, { foregroundBackground, action, intensity, w, h }) {
  const mask = foregroundBackground?.foregroundMask;
  if (!mask) return;

  putMask(mask);
  ensureCanvas(_layerCanvas, w, h);

  if (action.backgroundOpacity > 0) {
    _layerCtx.save();
    _layerCtx.globalCompositeOperation = "source-over";
    _layerCtx.clearRect(0, 0, w, h);
    _layerCtx.fillStyle = rgb(action.backgroundColor);
    _layerCtx.fillRect(0, 0, w, h);
    _layerCtx.globalCompositeOperation = "destination-out";
    _layerCtx.drawImage(_maskCanvas, 0, 0, w, h);
    _layerCtx.restore();

    ctx.save();
    ctx.globalAlpha = action.backgroundOpacity * intensity;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(_layerCanvas, 0, 0, w, h);
    ctx.restore();
  }

  _layerCtx.save();
  _layerCtx.globalCompositeOperation = "source-over";
  _layerCtx.clearRect(0, 0, w, h);
  _layerCtx.drawImage(_maskCanvas, 0, 0, w, h);
  _layerCtx.globalCompositeOperation = "source-in";
  _layerCtx.fillStyle = rgb(action.foregroundColor);
  _layerCtx.fillRect(0, 0, w, h);
  _layerCtx.restore();

  ctx.save();
  ctx.globalAlpha = action.opacity * intensity;
  ctx.globalCompositeOperation = "screen";
  const glow = action.glow * 30;
  if (glow > 0.5) {
    ctx.shadowBlur = glow;
    ctx.shadowColor = rgb(action.foregroundColor);
  }
  ctx.drawImage(_layerCanvas, 0, 0, w, h);
  ctx.restore();
}
