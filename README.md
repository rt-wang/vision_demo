# Mirage

A live, object-aware creative-vision instrument that runs entirely in the browser. Your webcam feeds an object detector (COCO-SSD) and OpenCV.js extracts a foreground/background mask (MOG2) and a scene-level Canny edge mask. Those mask canvases plus the raw camera frame are bound as textures to an **AI-authored GLSL fragment shader** that paints the scene. The user can prompt the model for a new shader, edit the resulting GLSL directly, and recompile in place.

Phase 5 replaces the earlier `ActionPlan` system: the AI no longer picks from a fixed vocabulary of effects — it writes the shader code that decides how scene structure becomes the final image.

On top of the visual pipeline you can drop in your own audio track that reacts to the on-screen color, save any shader you like as a preset, and record the live output (video **and** audio) to a `.webm` file — all in the browser, no upload.

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
- **Intensity slider**: a scalar uniform (`u_intensity`) the shader is encouraged to honor. It also sets the audio master volume.
- **GLSL editor** (`e`): a slide-out panel with the active fragment shader source. Edit and press **Render** (or Cmd/Ctrl+Enter) to recompile. Compile errors render inline; the last working shader stays active.
- **Presets** (`p`): a slide-out panel of saved shaders (see [Presets](#presets)).
- **Audio** (titlebar): upload a track that reacts to the on-screen color (see [Audio](#audio)).
- **Record** (`r`): capture the live output to a `.webm` (see [Recording](#recording)).
- **Debug view** (`d`): cycle through SHADER → VIDEO → FG MASK → EDGE MASK to see exactly what OpenCV is feeding the shader.
- **Hotkeys panel**: the `HOTKEYS` button reveals the full keyboard cheat sheet in-app.
- **Keyboard**: `/` focuses the prompt, `Enter` submits, `Escape` dismisses. `e` editor, `p` presets, `s` save current as preset, `d` cycle debug views, `c` toggle camera feed, `r` record/stop, `v` swap source between camera and a video file, `i` immersive view, `Cmd/Ctrl+Enter` compile shader.

---

## Audio

Click **AUDIO** in the titlebar and pick any audio file (it stays local — nothing is uploaded). It loops through a Web Audio graph whose parameters are driven, every frame, by the *average color of the rendered output* — so the music shifts as the shader does. Nothing is heard until you load a track.

| Output signal | Audio effect |
| --- | --- |
| Hue | Lowpass cutoff, 500 Hz → 16 kHz (red = dark/muffled, blue = bright) |
| Hue ≈ 60° (yellow) | High-shelf treble boost — sparkly/"heavenly" |
| Hue ≈ 220° (blue) | Delay echo (wet + feedback) — spacious |
| Saturation | Soft distortion + filter resonance |
| Lightness | Reverb wet mix (a dark screen stays dry) |
| Scene motion | Tremolo rate + depth |
| Intensity slider | Master volume |

A near-black frame fades the color-driven effects toward neutral, so a dim scene doesn't sound mangled.

## Recording

Click **REC** (or press `r`) to record. The output canvas is captured frame-by-frame (synced to the render loop) and muxed with the live audio graph into a `video/webm` stream via `MediaRecorder`. A timer shows in the top overlay; click **STOP** (or `r` again) and the browser downloads a timestamped `mirage-*.webm`. If no audio track is loaded, the recording is video-only.

## Presets

Press `s` (or **Save current** in the Presets panel) to store the active shader — title, description, and GLSL source — in `localStorage`. Open the panel with `p` or **PRESETS**:

- **Click** an entry to apply it (it also loads into the editor).
- **Right-click** an entry to rename it inline.
- **×** deletes it.

Presets persist across reloads on the same browser. They are local only — there's no server-side store.

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
  index.html               # window shell, control bar, shader editor, presets panel, CDN script tags
  styles.css               # dark immersive UI (responsive — fits any screen)
  app.js                   # capture loop, prompt flow, intensity smoothing, shader render dispatch, recording, presets
  package.json             # server deps + npm start
  audio/
    audioEngine.js         # color/motion-reactive Web Audio graph + recording stream
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
| 6 | 🚧 | Color/motion-reactive audio engine, in-browser video+audio recording, saved shader presets, responsive layout. |
| 7 | ⏳ | Object box / depth uniforms; richer per-object shader effects. |

See `phase_5_shader_implementation.md` for the full Phase 5 design.
