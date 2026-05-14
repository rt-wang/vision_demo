# Latent Canvas

A live, object-aware creative-vision instrument that runs entirely in the browser. Your webcam feeds an object detector (COCO-SSD), each detected object becomes its own small canvas for object-local computer vision (OpenCV.js — Canny edges, Hough lines), and a deterministic action renderer composites styled effects (aura, spotlight, glitch, trails, edges, lines, foreground/background masks) per object based on an `ActionPlan` — either a hardcoded preset or one generated from a natural-language prompt by an LLM.

Phase 1–4A plus the Phase 4B `foregroundBackground` action are implemented. The remaining Phase 4B actions and Phases 4C–6 are roadmap.

---

## Run it

You have two modes:

| Mode | Camera + detection | Presets | Prompt → plan |
| --- | --- | --- | --- |
| **Static-only** | Yes | Yes | Local mock planner (keyword-based fallback) |
| **Full LLM** | Yes | Yes | Real Anthropic-backed planner |

Pick the one you need. The frontend is identical — only the server differs.

### Static-only (no install)

Serves the files; the prompt UI falls back to the local mock planner.

```bash
cd path/to/vision_demo
python3 -m http.server 8000
```

Open <http://localhost:8000> and grant camera access. Type prompts like "make the person sacred" or "cold and glitchy" — the mock planner recognizes a small mood vocabulary and produces a valid plan.

`npx serve .` works identically.

### Full LLM (Node reference server)

Runs the same frontend AND a `/api/plan` endpoint that calls Anthropic.

```bash
cd path/to/vision_demo
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Open <http://localhost:8000>. The prompt status pill shows `applied` when the LLM-generated plan lands; if the API key is missing or the call fails, the frontend silently falls back to the mock planner and shows `mock`.

Optional env vars:

- `PORT` — listen port, default `8000`.
- `LATENT_CANVAS_MODEL` — Anthropic model id, default `claude-sonnet-4-6`.

### First-load notes

- The browser fetches OpenCV.js (~5 MB) and the COCO-SSD weights (~9 MB) from CDNs. After that they're cached.
- The boot overlay tells you what's loading. The status pill in the title bar turns green once the detector is ready.
- The camera prompt is browser-driven. If you accidentally deny it, re-enable in site settings.

---

## Controls

- **Prompt** (bottom bar): natural-language direction, e.g.
  - `make the person sacred and the laptop poisonous`
  - `cold mirror with glitching screens`
  - `everything radioactive`
- **Preset chips**: `Neutral`, `Sacred Contamination`, `Cold Mirror`, `Glitch Storm`. Click any to override the LLM plan with a hardcoded one.
- **Intensity slider**: master scalar (0–100%) on every styled action's opacity and global-style strength.
- **Keyboard**: `/` focuses the prompt, `Enter` submits it, `Escape` blurs it. `1–4` selects a preset by index (ignored while the prompt is focused). `i` toggles the **plan inspector** (also: `JSON` button in the title bar) — a slide-out panel showing the active `ActionPlan` JSON, its source (`preset` / `llm` / `mock`), and any validator warnings or errors.
- **Top-left badge**: live object count. **Top-right badge**: active plan title. **Title bar**: FPS + status. **Prompt status pill**: `planning…` → `applied` (LLM) or `mock` (fallback) or `invalid` (rejected plan).

---

## Architecture

```
captureCanvas → COCO-SSD → tracker → DetectedObject[]
                                    ↘
                                     object-local CV → ObjectGeometry[]
                                    ↘
                                     scene signals → planner payload
                                                          ↓
prompt input ─────────────────────────────────────→ /api/plan (Anthropic)
                                                          ↓
                                                  validateActionPlan
                                                          ↓
                                                   ActionPlan
                                                          ↓
                                                  drawStyledPlan
```

Key contract: the LLM gets **expressive control, not execution control**. It chooses from a constrained `CreativeAction` vocabulary; every numeric is clamped to [0,1]; unknown action types / blend modes / label modes are dropped; selector classes are filtered against COCO + currently-detected. The renderer never sees an un-sanitized plan.

---

## Project layout

```
vision_demo/
  index.html              # window shell, control bar, CDN script tags
  styles.css              # dark immersive UI
  app.js                  # capture loop, prompt flow, intensity smoothing, render dispatch
  package.json            # server deps + npm start
  analysis/
    objectDetector.js     # COCO-SSD wrapper
    objectTracker.js      # per-class IoU tracking + EMA bbox smoothing
    objectLocalCv.js      # per-bbox Canny + Hough Lines (OpenCV.js)
    foregroundBackground.js # full-frame MOG2 foreground mask (OpenCV.js)
    sceneSignals.js       # summary stats sent to the planner
  render/
    neutralPreview.js     # inspection layer (boxes, labels, faint geometry)
    actionRenderer.js     # orchestrator (design's render order)
    actions/              # aura, localEdges, localLines, foregroundBackground, spotlight, trail, glitch
  llm/
    actionPlanSchema.js   # action/blend whitelist + clamp helpers
    validateActionPlan.js # parses + sanitizes any plan before rendering
    plannerPrompt.js      # system + user prompt template (server-side)
    planClient.js         # frontend client (real fetch + mock fallback)
    mockPlanner.js        # keyword fallback for static-only dev
    defaultPlans.js       # hardcoded ActionPlan presets
  server/
    planRoute.js          # Node reference server (static + /api/plan)
  design.md
  object-local-cv-design.md
  phase_4_implementation.md
```

---

## Troubleshooting

- **Black canvas, no camera**: open the browser console. A permission denial or non-secure-origin issue will be the first thing reported. URLs must start with `http://localhost` or `https://`.
- **Prompt says `mock`**: the backend isn't reachable. Either you're on the static-only server (expected), or `ANTHROPIC_API_KEY` isn't set, or the API call failed. Check the server logs.
- **Prompt says `invalid`**: the LLM returned something the validator couldn't repair into a plan with at least one rule. The previous plan is kept. Check the server logs for the raw response.
- **FPS drops on `Glitch Storm` or heavy prompts**: drop the intensity slider, or remove the trail action from the prompt.
- **Mirror feels wrong**: the canvas is intentionally mirrored at capture so it reads like a selfie cam. Detection, CV, and overlays all live in display space.

---

## Roadmap

| Phase | Status | Summary |
| --- | --- | --- |
| 1 | ✅ | Object-first refactor: detection is the only analysis root, tracker IDs + smoothed bboxes. |
| 2 | ✅ | Object-local CV: Canny + Hough run on each tracked bbox crop only — background never analyzed. |
| 3 | ✅ | Deterministic action vocabulary, hardcoded presets, intensity slider, smooth transitions. |
| 4A | ✅ | Prompt → validated ActionPlan loop with mock + Anthropic backends. |
| 4B | ⏳ | `foregroundBackground` implemented; `localDepth` + `freezeBox` remaining. |
| 4C | ⏳ | Richer scene signals in the planner payload. |
| 5 | ⏳ | Click-to-select object, capped detector FPS, conditional CV. |
| 6 | ⏳ | Scene relationships: distance, proximity, tension lines, `nearClass`. |

See `object-local-cv-design.md` and `phase_4_implementation.md` for the full design.
