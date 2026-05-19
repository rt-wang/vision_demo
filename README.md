# Mirage

A live, object-aware creative-vision instrument that runs entirely in the browser. Your webcam feeds an object detector (COCO-SSD) and OpenCV.js extracts a foreground/background mask (MOG2) and a scene-level Canny edge mask. Those mask canvases plus the raw camera frame are bound as textures to an **AI-authored GLSL fragment shader** that paints the scene. The user can prompt the model for a new shader, edit the resulting GLSL directly, and recompile in place.

Phase 5 replaces the earlier `ActionPlan` system: the AI no longer picks from a fixed vocabulary of effects — it writes the shader code that decides how scene structure becomes the final image.

---

## Run it

You have two modes:

| Mode | Camera + OpenCV masks + default shader | Prompt → AI-authored shader |
| --- | --- | --- |
| **Static-only** | Yes | No (the prompt requires the Node server) |
| **Full LLM** | Yes | Yes — Anthropic-backed `/api/shader` |

The frontend is identical — only the server differs.

### Static-only (no install)

Serves the files; the default OpenCV-aware shader runs, the editor and debug views work, but the prompt has nowhere to call.

```bash
cd path/to/vision_demo
python3 -m http.server 8000
```

Open <http://localhost:8000> and grant camera access. Open the editor (`e`) to inspect or modify the default shader and recompile (Cmd/Ctrl+Enter).

`npx serve .` works identically.

### Full LLM (Node reference server)

Runs the same frontend AND a `/api/shader` endpoint that calls Anthropic.

```bash
cd path/to/vision_demo
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Open <http://localhost:8000>. Type a prompt like "turn the moving foreground into a thermal ghost and make object edges glow green" and click **Generate**. The model returns a complete GLSL fragment shader; the browser validates it, compiles it, and starts rendering. If compilation fails, the last working shader keeps running and the editor shows the GLSL compiler log inline.

Optional env vars:

- `PORT` — listen port, default `8000`.
- `LATENT_CANVAS_MODEL` — Anthropic model id, default `claude-sonnet-4-6`. (env var name unchanged)

### First-load notes

- The browser fetches OpenCV.js (~5 MB) and the COCO-SSD weights (~9 MB) from CDNs. After that they're cached.
- The boot overlay tells you what's loading. The status pill in the title bar turns green once the detector is ready and the default shader has compiled.

---

## Controls

- **Prompt** (bottom bar): natural-language direction, e.g.
  - `thermal ghost foreground with electric green edges`
  - `infrared body with scanline overlay`
  - `dim everything except the moving silhouette and trace its outline`
- **Intensity slider**: a scalar uniform (`u_intensity`) the shader is encouraged to honor.
- **GLSL editor** (`e`): a slide-out panel with the active fragment shader source. Edit and press **Render** (or Cmd/Ctrl+Enter) to recompile. Compile errors render inline; the last working shader stays active.
- **Debug view** (`d`): cycle through SHADER → VIDEO → FG MASK → EDGE MASK to see exactly what OpenCV is feeding the shader.
- **Keyboard**: `/` focuses the prompt, `Enter` submits, `Escape` blurs. `e` toggles the editor, `d` cycles debug views, `c` toggles the camera feed, `v` swaps source between camera and a video file.

---

## Architecture

```
captureCanvas → COCO-SSD → tracker → DetectedObject[]   (scene signals)
              → MOG2 foreground mask canvas              (u_fgMask)
              → scene-level Canny edge mask canvas       (u_edgeMask)
              ↓
prompt input ──→ /api/shader (Anthropic) ──→ validateShaderPlan
                                                  ↓
                                            { fragmentShader }
                                                  ↓
                                        WebGL compile + draw
                                                  ↓
                                            output canvas
```

Key contract: the LLM gets **shader-level expressive control, not arbitrary execution**. It writes only GLSL ES 1.00 fragment shader source against a fixed uniform header (`u_video`, `u_fgMask`, `u_edgeMask`, `u_resolution`, `u_time`, `u_intensity`, `u_hasFgMask`, `u_hasEdgeMask`). The validator strips markdown fences, rejects JavaScript-shaped strings, requires `precision mediump float`, `void main`, and `u_video`, and caps total size. The browser's GLSL compiler is the only thing that ever executes the generated text.

---

## Project layout

```
vision_demo/
  index.html               # window shell, control bar, shader editor, CDN script tags
  styles.css               # dark immersive UI
  app.js                   # capture loop, prompt flow, intensity smoothing, shader render dispatch
  package.json             # server deps + npm start
  analysis/
    objectDetector.js      # COCO-SSD wrapper
    objectTracker.js       # per-class IoU tracking + EMA bbox smoothing
    foregroundBackground.js  # full-frame MOG2 foreground mask canvas (u_fgMask)
    sceneEdgeMask.js       # full-frame Canny edge mask canvas (u_edgeMask)
    objectLocalCv.js       # per-bbox Canny + Hough Lines (legacy, currently unused at render time)
    sceneSignals.js        # summary stats sent to the shader prompt
  render/
    shader/
      shaderRenderer.js    # WebGL context + program lifecycle + frame draw
      shaderTextures.js    # canvas → WebGL texture upload
      defaultShaders.js    # OpenCV-aware default + debug shaders
    actionRenderer.js      # legacy Phase 4 renderer (no longer in the render path)
    neutralPreview.js      # legacy inspection layer
    actions/               # legacy per-effect renderers (kept as reference)
  llm/
    shaderPrompt.js        # shader system + user prompt template (server-side)
    validateShaderPlan.js  # parses + sanitizes any shader plan before compilation
    shaderClient.js        # frontend client for /api/shader
    actionPlanSchema.js    # legacy Phase 4 schema
    validateActionPlan.js  # legacy Phase 4 validator
    plannerPrompt.js       # legacy Phase 4 prompt
    planClient.js          # legacy Phase 4 client
    mockPlanner.js         # legacy Phase 4 mock
    defaultPlans.js        # legacy Phase 4 presets
  server/
    planRoute.js           # Node reference server entry (static + /api/shader)
    shaderRoute.js         # /api/shader handler (Anthropic call + validation)
  phase_4_implementation.md
  phase_5_shader_implementation.md
```

---

## Troubleshooting

- **Black canvas, no camera**: open the browser console. A permission denial or non-secure-origin issue will be the first thing reported. URLs must start with `http://localhost` or `https://`.
- **Compile error in editor**: the shader violated the GLSL contract (missing `void main`, missing `precision`, missing `u_video`, etc.) or hit a WebGL compiler error. The last working shader keeps running; fix the code and press **Render**.
- **Prompt fails with `invalid`**: the LLM returned something the validator rejected (no `fragmentShader`, forbidden JS-shaped content, oversized output). The previous shader is kept. Check the server logs for the raw response.
- **Foreground mask looks empty for a few seconds**: MOG2 needs a few frames to learn the static background before silhouettes appear. Move briefly so it can separate you from the room.
- **Mirror feels wrong**: the camera capture is intentionally mirrored so it reads like a selfie cam. Detection and shader sampling all live in this display space.

---

## Roadmap

| Phase | Status | Summary |
| --- | --- | --- |
| 1 | ✅ | Object-first refactor: detection is the only analysis root, tracker IDs + smoothed bboxes. |
| 2 | ✅ | Object-local CV: Canny + Hough run on each tracked bbox crop only. |
| 3 | ✅ | Deterministic action vocabulary, hardcoded presets, intensity slider. |
| 4 | ✅ | Prompt → validated ActionPlan loop with mock + Anthropic backends. |
| 5 | ✅ | AI-authored GLSL: shader is the renderer; OpenCV masks feed the shader; prompt → fragment shader → live compile. |
| 6 | ⏳ | Object box / depth uniforms; richer per-object shader effects. |

See `phase_5_shader_implementation.md` for the full Phase 5 design.
