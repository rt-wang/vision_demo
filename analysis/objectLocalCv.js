/*
 * Object-local CV analysis (Phase 2).
 *
 * For each tracked object we crop the smoothed bbox out of the capture frame
 * (via cv.Mat.roi — a zero-copy view into the source pixels), then run Canny
 * + probabilistic Hough Lines inside that crop. The background is never
 * touched — there is no full-frame edge pass.
 *
 * Output is the ObjectGeometry shape from the design doc:
 *   - localLines: line segments translated back to full-canvas pixel coords
 *   - localEdges: ImageData of the edge mask, sized to the crop, tinted with
 *                 the accent color and using the canny intensity as alpha so
 *                 a renderer can drawImage it directly with globalAlpha
 *   - localEdgesOrigin: where to position localEdges on the output canvas
 *
 * Mat reuse: gray/edges/lines/roiRgb are allocated once and resized
 * automatically by OpenCV when used as destinations of different-sized ops.
 * Only the full-frame `src` Mat is allocated per frame (one allocation /
 * frame regardless of object count).
 */

const MIN_CROP_PX = 12;

let _src = null;
let _gray = null;
let _edges = null;
let _lines = null;
let _depthGray = null;
let _depthFiltered = null;

function disposeMat(m) {
  if (m && !m.isDeleted?.()) {
    try { m.delete(); } catch (_) { /* ignore */ }
  }
}

export function disposeLocalCvMats() {
  disposeMat(_src); _src = null;
  disposeMat(_gray); _gray = null;
  disposeMat(_edges); _edges = null;
  disposeMat(_lines); _lines = null;
  disposeMat(_depthGray); _depthGray = null;
  disposeMat(_depthFiltered); _depthFiltered = null;
}

function ensureScratchMats(cv) {
  if (!_gray) _gray = new cv.Mat();
  if (!_edges) _edges = new cv.Mat();
  if (!_lines) _lines = new cv.Mat();
}

function ensureDepthMats(cv) {
  if (!_depthGray) _depthGray = new cv.Mat();
  if (!_depthFiltered) _depthFiltered = new cv.Mat();
}

function clampRect(bbox, W, H) {
  const x = Math.max(0, Math.floor(bbox[0]));
  const y = Math.max(0, Math.floor(bbox[1]));
  const w = Math.min(W - x, Math.ceil(bbox[2]));
  const h = Math.min(H - y, Math.ceil(bbox[3]));
  return { x, y, width: w, height: h };
}

function edgeMatToImageData(mat) {
  // mat is CV_8UC1 (Canny output, 0 or 255). Build an RGBA ImageData where
  // alpha mirrors the edge value and color is white. Each renderer recolors
  // the mask at draw time (source-in composite + fillRect), so the same
  // geometry can power any action regardless of palette.
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

export function isReady() {
  return !!(window.cv && window.cv.Mat);
}

function depthMatToGrayData(mat) {
  // mat is CV_8UC1 — copy into a fresh typed array sized exactly to the crop.
  // We can't hand the underlying Mat data straight to the renderer because
  // OpenCV reuses the buffer on the next call.
  const w = mat.cols;
  const h = mat.rows;
  const out = new Uint8ClampedArray(w * h);
  out.set(mat.data);
  return out;
}

/**
 * Run object-local CV for each non-stale tracked object.
 * Returns a Map<objectId, ObjectGeometry>.
 *
 * `options.includeDepth` triggers the localDepth analysis: bilateral filter +
 * histogram equalization on the grayscale crop, output as a single-channel
 * Uint8 buffer. Palette/colormap is applied at render time so each rule can
 * pick its own palette without re-running CV.
 */
export function computeObjectGeometry(captureCanvas, objects, options = {}) {
  const cv = window.cv;
  const result = new Map();
  if (!cv || !cv.Mat) return result;

  ensureScratchMats(cv);
  const includeDepth = !!options.includeDepth;
  if (includeDepth) ensureDepthMats(cv);

  // Read the full frame once per frame. OpenCV.js imread always allocates a
  // new Mat, so we delete the previous one to keep the heap flat.
  disposeMat(_src);
  _src = cv.imread(captureCanvas);

  const W = captureCanvas.width;
  const H = captureCanvas.height;

  for (const obj of objects) {
    if (obj.stale) continue;
    const rect = clampRect(obj.bbox, W, H);
    if (rect.width < MIN_CROP_PX || rect.height < MIN_CROP_PX) continue;

    let roi = null;
    try {
      // Zero-copy ROI into the full-frame Mat.
      roi = _src.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));

      cv.cvtColor(roi, _gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(_gray, _gray, new cv.Size(5, 5), 1.4, 1.4, cv.BORDER_DEFAULT);
      cv.Canny(_gray, _edges, 60, 150, 3, false);

      // Hough thresholds scaled to crop size so small objects still emit lines
      // and large objects don't drown in noise.
      const minDim = Math.min(rect.width, rect.height);
      const houghThreshold = Math.max(18, Math.floor(minDim * 0.22));
      const minLineLen = Math.max(10, Math.floor(minDim * 0.18));
      const maxGap = Math.max(6, Math.floor(minDim * 0.06));

      cv.HoughLinesP(
        _edges,
        _lines,
        1,
        Math.PI / 180,
        houghThreshold,
        minLineLen,
        maxGap,
      );

      const localLines = [];
      const data = _lines.data32S;
      for (let i = 0; i < _lines.rows; i++) {
        const x1 = rect.x + data[i * 4];
        const y1 = rect.y + data[i * 4 + 1];
        const x2 = rect.x + data[i * 4 + 2];
        const y2 = rect.y + data[i * 4 + 3];
        localLines.push([x1, y1, x2, y2]);
      }

      const localEdges = edgeMatToImageData(_edges);

      const geom = {
        objectId: obj.id,
        bbox: rect,
        localEdges,
        localEdgesOrigin: [rect.x, rect.y],
        localLines,
        localMotionAmount: 0,
      };

      if (includeDepth) {
        // Bilateral filter needs a fresh grayscale source — _gray is already
        // blurred from the Canny pass. Re-derive grayscale into _depthGray.
        cv.cvtColor(roi, _depthGray, cv.COLOR_RGBA2GRAY);
        try {
          cv.bilateralFilter(_depthGray, _depthFiltered, 5, 50, 50, cv.BORDER_DEFAULT);
          cv.equalizeHist(_depthFiltered, _depthFiltered);
        } catch (_) {
          // Some OpenCV.js builds omit bilateralFilter — fall back to equalize
          // on the grayscale crop directly so localDepth still renders.
          cv.equalizeHist(_depthGray, _depthFiltered);
        }
        geom.localDepth = depthMatToGrayData(_depthFiltered);
        geom.localDepthSize = { width: _depthFiltered.cols, height: _depthFiltered.rows };
      }

      result.set(obj.id, geom);
    } finally {
      disposeMat(roi);
    }
  }

  return result;
}
