# Latent Canvas

A live, object-aware creative-vision instrument that runs entirely in the browser. Your webcam feeds an object detector (COCO-SSD), each detected object becomes its own small canvas for object-local computer vision (OpenCV.js — Canny edges, Hough lines), and a deterministic action renderer composites styled effects (aura, spotlight, glitch, trails, edges, lines) per object based on a selectable `ActionPlan` preset.

Phase 1–3 of `object-local-cv-design.md` are implemented. Phases 4–6 (LLM action planner, click-to-select, scene relationships) are roadmap.

---

## Run it

You need a static file server — browsers block `getUserMedia` over `file://`. Localhost counts as a secure origin, so any local server will work.

### Option A — Python (no install needed on macOS/Linux)

```bash
cd path/to/vision_demo
python3 -m http.server 8000
```

Then open <http://localhost:8000> in Chrome, Edge, or any Chromium-based browser. Grant the camera permission when prompted.

### Option B — Node / npx

```bash
cd path/to/vision_demo
npx serve .
```

`npx serve` will print the URL it's listening on (usually <http://localhost:3000>).

### Option C — Any other static server

`http-server`, `live-server`, VS Code's Live Server extension, etc. all work. The repo is plain HTML/CSS/JS modules — no build step.

### First-load notes

- The first load fetches OpenCV.js (~5 MB) and the COCO-SSD weights (~9 MB) from CDNs. After that, browsers cache them.
- The boot overlay tells you what's loading. The status pill in the title bar turns green once the detector is ready.
- The camera prompt is browser-driven — if you accidentally deny it, you'll need to re-enable it in the site settings.

---

## Controls

- **Preset chips** (bottom bar): switch between `Neutral`, `Sacred Contamination`, `Cold Mirror`, `Glitch Storm`.
- **Intensity slider**: master scalar (0–100%) on every styled action's opacity and global-style strength.
- **Keyboard 1–4**: select preset by index.
- **Top-left badge**: live object count. **Top-right badge**: active plan title. **Title bar**: FPS + status.

---

## Browser support

- Tested on recent Chrome / Edge / Arc on macOS. Should also work on recent Firefox and Safari, though OpenCV.js cold-start tends to be slower in Safari.
- Requires WebGL (for TensorFlow.js) and WebAssembly (for OpenCV.js). Both are universal in modern browsers.

---

## Project layout

```
vision_demo/
  index.html              # window shell, control bar, CDN script tags
  styles.css              # dark immersive UI
  app.js                  # capture loop, mode dispatch, intensity smoothing
  analysis/
    objectDetector.js     # COCO-SSD wrapper
    objectTracker.js      # per-class IoU tracking + EMA bbox smoothing
    objectLocalCv.js      # per-bbox Canny + Hough Lines (OpenCV.js)
  render/
    neutralPreview.js     # inspection layer (boxes, labels, faint geometry)
    actionRenderer.js     # orchestrator following the design's render order
    actions/
      aura.js
      localEdges.js
      localLines.js
      spotlight.js
      trail.js
      glitch.js
  llm/
    actionPlanSchema.js   # action/blend whitelist + clamp helpers
    defaultPlans.js       # hardcoded ActionPlan presets
  design.md
  object-local-cv-design.md
```

---

## Troubleshooting

- **Black canvas, no camera**: open the browser console. A permission denial or HTTPS/secure-origin issue will be the first thing reported. Make sure the URL starts with `http://localhost` or `https://`, not `file://`.
- **"camera ready" but no boxes**: the detector model is still downloading. Status flips to `ready` once it's loaded.
- **FPS drops on `Glitch Storm`**: that preset stacks `glitch + trail + aura` per object. Drop the intensity slider, or pick a lighter preset.
- **Mirror feels wrong**: the canvas is intentionally mirrored at capture so it reads like a selfie cam. Detection, CV, and overlays all live in that same display space.

---

## Roadmap

| Phase | Status | Summary |
| --- | --- | --- |
| 1 | ✅ | Object-first refactor: detection is the only analysis root, with tracker IDs + smoothed bboxes. |
| 2 | ✅ | Object-local CV: Canny + Hough run on each tracked bbox crop only — background is never analyzed. |
| 3 | ✅ | Deterministic action vocabulary, hardcoded presets, intensity slider, smooth transitions. |
| 4 | ⏳ | LLM action planner — prompt-to-`ActionPlan` over a validated schema. |
| 5 | ⏳ | Click-to-select object, capped detector FPS, conditional CV. |
| 6 | ⏳ | Scene relationships: distance, proximity, tension lines, `nearClass`. |

See `object-local-cv-design.md` for the full design.
