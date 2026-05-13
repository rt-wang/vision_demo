/*
 * Neutral preview renderer.
 *
 * The inspection layer — what the user sees before any styled action plan is
 * applied. Draws:
 *   - raw camera
 *   - every tracked object's bbox + literal `class · NN%` label
 *   - tracker-assigned `#id` corner tag so persistence is visible
 *   - faint local-CV geometry (Canny edges + Hough lines) inside each bbox
 *     when an ObjectGeometry is provided for that object
 *
 * Phase 2+ will add the styled renderer alongside this; both consume the same
 * DetectedObject list and (optionally) the same geometry map.
 */

// Pooled offscreen canvas for tinting+blitting the white edge mask.
const _edgeBlitCanvas = document.createElement("canvas");
const _edgeBlitCtx = _edgeBlitCanvas.getContext("2d");
const PREVIEW_EDGE_TINT = "rgb(126, 240, 197)";
const PREVIEW_EDGE_ALPHA = 0.42;

function drawEdges(ctx, geom) {
  const img = geom.localEdges;
  if (!img) return;
  if (_edgeBlitCanvas.width !== img.width) _edgeBlitCanvas.width = img.width;
  if (_edgeBlitCanvas.height !== img.height) _edgeBlitCanvas.height = img.height;
  _edgeBlitCtx.save();
  _edgeBlitCtx.globalCompositeOperation = "source-over";
  _edgeBlitCtx.clearRect(0, 0, img.width, img.height);
  _edgeBlitCtx.putImageData(img, 0, 0);
  _edgeBlitCtx.globalCompositeOperation = "source-in";
  _edgeBlitCtx.fillStyle = PREVIEW_EDGE_TINT;
  _edgeBlitCtx.fillRect(0, 0, img.width, img.height);
  _edgeBlitCtx.restore();

  const [ox, oy] = geom.localEdgesOrigin;
  ctx.save();
  ctx.globalAlpha = PREVIEW_EDGE_ALPHA;
  ctx.drawImage(_edgeBlitCanvas, ox, oy);
  ctx.restore();
}

function drawLines(ctx, geom, w) {
  if (!geom.localLines || geom.localLines.length === 0) return;
  ctx.save();
  ctx.lineWidth = Math.max(1, w * 0.0015);
  ctx.strokeStyle = "rgba(126, 240, 197, 0.55)";
  ctx.lineCap = "round";
  ctx.shadowBlur = 6;
  ctx.shadowColor = "rgba(126, 240, 197, 0.45)";
  for (const [x1, y1, x2, y2] of geom.localLines) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawNeutralPreview(ctx, captureCanvas, objects, geometries, opts = {}) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.hideFeed) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.drawImage(captureCanvas, 0, 0, w, h);
  }

  const fontSize = Math.max(14, Math.floor(w * 0.018));
  const idFontSize = Math.max(10, fontSize - 4);
  const labelFont = `${fontSize}px ui-monospace, Menlo, monospace`;
  const idFont = `${idFontSize}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, w * 0.0025);

  for (const o of objects) {
    if (o.stale) continue;
    const [x, y, bw, bh] = o.bbox;

    // Local geometry first so it sits underneath the box stroke.
    const geom = geometries && geometries.get(o.id);
    if (geom) {
      drawEdges(ctx, geom);
      drawLines(ctx, geom, w);
    }

    // Box.
    ctx.strokeStyle = "rgba(126, 240, 197, 0.95)";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(126, 240, 197, 0.55)";
    ctx.strokeRect(x, y, bw, bh);
    ctx.shadowBlur = 0;

    // Tracker ID in the box corner so persistence across frames is visible.
    ctx.font = idFont;
    ctx.fillStyle = "rgba(126, 240, 197, 0.65)";
    ctx.fillText(o.id.replace(/^obj_/, "#"), x + 6, y + idFontSize);

    // Class + confidence label.
    ctx.font = labelFont;
    const label = `${o.className} · ${Math.round(o.score * 100)}%`;
    const padX = 8;
    const padY = 4;
    const m = ctx.measureText(label);
    const lw = m.width + padX * 2;
    const lh = fontSize + padY * 2;
    const lx = Math.max(0, x);
    const ly = Math.max(0, y - lh);

    ctx.fillStyle = "rgba(126, 240, 197, 0.95)";
    ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = "#06120e";
    ctx.fillText(label, lx + padX, ly + lh / 2);
  }

  ctx.restore();
}
