# Phase 5 Implementation: AI-Authored OpenCV Shader Canvas

## 1. Goal

Phase 5 replaces the Phase 4 `ActionPlan` direction with a shader-first system.

The AI should not merely choose from a fixed vocabulary of effects. In Phase 5, the AI generates GLSL fragment shader code, the app compiles that shader in WebGL, and the user can inspect, edit, and rerender the generated code.

The important hybrid stays:

```txt
OpenCV / detection / tracking understands the scene.
AI-generated GLSL shader code paints the scene.
```

Unlike the earlier Phase 5 draft, we should not start with a video-only shader. We should skip that step and make the first milestone OpenCV-aware from the beginning.

Minimum Phase 5 input contract:

- `u_video`: live camera/video frame
- `u_fgMask`: OpenCV foreground/background mask
- `u_edgeMask`: OpenCV/Canny edge mask
- `u_resolution`
- `u_time`
- `u_intensity`
- mask availability flags

Tracked object boxes and depth/material maps can follow after the first OpenCV-aware shader path is working.

## 2. Architectural Decision

Phase 5 should discard the old `ActionPlan` feature as a user-facing rendering path.

That means:

- No `Preset | ActionPlan | Shader` mode switch in the target Phase 5 UI.
- No LLM-generated `ActionPlan` as a fallback experience.
- No requirement that Phase 4 presets keep working in the Phase 5 product surface.
- No hybrid `ActionPlan + Shader` composition milestone.
- The generated shader becomes the primary visual program.

The existing Phase 4 code can still be useful while implementing:

- as reference for prompt submission,
- as reference for validation style,
- as temporary debugging fallback during development,
- as a source of existing OpenCV/mask/object data.

But Phase 5 should not present the `ActionPlan` system as part of the final roadmap.

## 3. Current Implementation Baseline

The current repo already has most of the perception side:

- `app.js` owns the live frame loop, camera/video-file input, capture canvas, object detection, object tracking, OpenCV-derived geometry, foreground/background analysis, prompt submission, and output drawing.
- `analysis/objectLocalCv.js` computes object-local CV features such as Canny edges and Hough lines.
- `analysis/foregroundBackground.js` computes a scene-level OpenCV foreground/background mask.
- `analysis/sceneSignals.js` summarizes detected objects and scene state.
- The current inspector UI already proves that generated text can be visible and editable.
- The current server route proves that prompts can be sent to an LLM from a local backend.

The parts to replace or retire for Phase 5:

- `render/actionRenderer.js` as the primary renderer.
- `llm/validateActionPlan.js` as the primary validator.
- `llm/plannerPrompt.js` as the primary prompt.
- `llm/defaultPlans.js` and preset UI as the user-facing visual system.
- `/api/plan` as the primary LLM endpoint.

The new center of the app should be:

```txt
app.js
  -> analysis/* OpenCV outputs
  -> render/shader/* WebGL renderer
  -> llm/shader* prompt + validation
  -> /api/shader
```

## 4. Core Principle

The AI may generate shader code, not arbitrary application code.

Allowed:

- GLSL ES 1.00 fragment shader code.
- Shader metadata such as title and short description.
- Bounded numeric/color defaults.
- Use of approved uniforms and helper functions.

Not allowed:

- Generated JavaScript.
- Generated DOM manipulation.
- Generated network requests.
- Generated model loading.
- Generated OpenCV pipeline code.
- Generated HTML or CSS.

This satisfies "AI generates code" while keeping execution contained inside the browser's WebGL shader compiler.

## 5. Target User Experience

The Phase 5 user experience should be direct:

1. User opens the app.
2. Camera or uploaded video starts.
3. OpenCV starts producing foreground and edge masks.
4. User types a prompt, such as "turn the moving foreground into a thermal ghost and make object edges glow green."
5. LLM returns a complete GLSL fragment shader.
6. App validates the shader plan and compiles the shader.
7. The shader renders the live frame using OpenCV mask textures.
8. The full shader source appears in an editable code panel.
9. User edits the shader and clicks `Render` or presses Cmd/Ctrl+Enter.
10. Compile errors appear inline; the last working shader remains active.

The first screen should feel like a live creative-coding instrument, not a preset selector.

## 6. Final Rendering Model

There is one Phase 5 rendering model:

```txt
video/camera frame
  -> captureCanvas
  -> object detection + tracking
  -> OpenCV foreground/background mask
  -> OpenCV edge mask
  -> shader texture bridge
      - u_video
      - u_fgMask
      - u_edgeMask
      - optional u_depthMap
      - optional object box uniforms
      - time/resolution/intensity
  -> AI-generated GLSL fragment shader
  -> WebGL shader canvas
  -> output canvas
```

The WebGL shader is the final renderer. The previous 2D `ActionPlan` compositor is not part of the Phase 5 target.

During implementation, a pass-through shader can be used as a temporary technical fallback:

```txt
u_video -> pass-through shader -> output canvas
```

But that fallback is a debugging tool, not a Phase 5 feature goal.

## 7. Shader State

Replace action-plan render state with shader render state.

Suggested state shape:

```js
shader: {
  title: "OpenCV Shader",
  description: "",
  source: "default" | "llm" | "edit" | "fallback",
  fragmentShader: "...",
  uniforms: {},
  compileStatus: "idle" | "ok" | "error",
  compileError: null,
  lastCompiledAt: 0
}
```

Suggested app-level rendering state:

```js
renderer: {
  ready: false,
  lastFrameHadFgMask: false,
  lastFrameHadEdgeMask: false,
  lastFrameObjectCount: 0
}
```

Avoid carrying forward `currentPlan`, `currentPlanSource`, `presetId`, and preset selection as primary concepts.

## 8. Required Shader Contract

The generated fragment shader must use a fixed uniform contract. The app owns the vertex shader, full-screen quad, texture binding, and uniform upload. The LLM writes the fragment shader only.

Required GLSL header:

```glsl
precision mediump float;

uniform sampler2D u_video;
uniform sampler2D u_fgMask;
uniform sampler2D u_edgeMask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_hasFgMask;
uniform float u_hasEdgeMask;

varying vec2 v_uv;
```

The shader should always include:

```glsl
void main() {
  vec4 video = texture2D(u_video, v_uv);
  gl_FragColor = video;
}
```

The model may add helper functions and visual logic, but it must preserve the required uniforms and `void main()`.

## 9. Default OpenCV-Aware Shader

The app should ship with a default shader that already uses OpenCV inputs. This replaces the earlier idea of starting with a plain video-only shader.

```glsl
precision mediump float;

uniform sampler2D u_video;
uniform sampler2D u_fgMask;
uniform sampler2D u_edgeMask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_hasFgMask;
uniform float u_hasEdgeMask;

varying vec2 v_uv;

void main() {
  vec4 video = texture2D(u_video, v_uv);
  float fg = texture2D(u_fgMask, v_uv).r * u_hasFgMask;
  float edge = texture2D(u_edgeMask, v_uv).r * u_hasEdgeMask;

  vec3 background = video.rgb * vec3(0.35, 0.42, 0.55);
  vec3 foreground = mix(video.rgb, vec3(1.0, 0.32, 0.08), 0.65 + 0.25 * sin(u_time * 2.0));
  vec3 color = mix(background, foreground, fg * u_intensity);
  color += edge * vec3(0.15, 1.0, 0.72) * (0.5 + u_intensity);

  gl_FragColor = vec4(color, 1.0);
}
```

This default proves the intended system immediately:

```txt
camera frame + OpenCV masks -> shader code -> live canvas
```

## 10. Files To Add

```txt
render/shader/
  shaderRenderer.js
  shaderTextures.js
  defaultShaders.js

llm/
  shaderPrompt.js
  shaderClient.js
  validateShaderPlan.js

server/
  shaderRoute.js
```

### `render/shader/shaderRenderer.js`

Owns the WebGL rendering path:

- Create a WebGL canvas/context.
- Compile a fixed vertex shader plus generated fragment shader.
- Keep the last successfully linked program.
- Draw a full-screen quad.
- Upload uniforms every frame.
- Bind `u_video`, `u_fgMask`, and `u_edgeMask`.
- Expose `compileShader(fragmentShader)`.
- Expose `renderShaderFrame(opts)`.
- Return structured compile errors.

### `render/shader/shaderTextures.js`

Bridges CPU/canvas/OpenCV outputs into WebGL textures:

- `captureCanvas` -> `u_video`
- foreground mask canvas -> `u_fgMask`
- edge mask canvas -> `u_edgeMask`

The first implementation can upload canvas sources with `texImage2D` each frame. Optimize only after the visual path works.

### `render/shader/defaultShaders.js`

Stores development shaders:

- OpenCV-aware default shader
- foreground mask debug shader
- edge mask debug shader
- thermal foreground example
- edge glow example

These are not user-facing presets. They are technical fixtures for debugging and recovery.

### `llm/shaderPrompt.js`

Defines the shader-generation system prompt and user-message builder.

It should explicitly ask for GLSL fragment shader code and include the fixed OpenCV-aware uniform contract.

### `llm/validateShaderPlan.js`

Sanitizes model output before compilation:

- Parse JSON.
- Require `fragmentShader`.
- Enforce size limits.
- Strip markdown fences.
- Require `precision mediump float`.
- Require `void main`.
- Require references to `u_video`.
- Strongly prefer or require at least one OpenCV input reference: `u_fgMask` or `u_edgeMask`.
- Clamp metadata strings.
- Return `{ ok, shaderPlan, errors }`.

### `server/shaderRoute.js`

Adds prompt-to-shader endpoint:

```txt
POST /api/shader
```

It should:

- accept prompt + scene summary + shader contract
- call the LLM
- validate JSON shape
- return generated shader code
- never execute generated code on the server

## 11. Files To Change

```txt
index.html
app.js
styles.css
README.md
server/planRoute.js
analysis/objectLocalCv.js
analysis/foregroundBackground.js
analysis/sceneSignals.js
```

### `index.html`

Replace preset/action-plan UI with shader UI:

- Prompt input remains.
- Preset row can be removed.
- `ActionPlan` inspector becomes a shader editor.
- Add `Render` / `Compile` button.
- Add compile status and compiler error area.
- Optional debug view buttons can show video, foreground mask, edge mask, or shader output.

Avoid a `Preset | ActionPlan | Shader` switch. The product surface should communicate that the shader is the main artifact.

### `app.js`

Refactor the frame loop around shader rendering:

- Remove user-facing preset/action-plan state.
- Keep camera/video-file source handling.
- Keep object detection/tracking.
- Keep scene signals for prompt context.
- Keep foreground/background analysis.
- Add scene-level edge mask generation if needed.
- Initialize WebGL shader renderer.
- Upload `captureCanvas`, foreground mask, and edge mask each frame.
- Draw the WebGL result into `output`.
- Submit prompts through `requestShaderPlan()`.
- Compile generated or edited shader source.

Target frame branch:

```js
renderShaderFrame({
  captureCanvas,
  foregroundMaskCanvas,
  edgeMaskCanvas,
  objects: state.objects,
  intensity: state.currentIntensity,
  timeMs: now,
});

outputCtx.drawImage(shaderRenderer.canvas, 0, 0);
```

Phase 5 should not call `drawStyledPlan()` in the main render path.

### `styles.css`

Add styles for:

- shader editor textarea
- compile button
- compile status
- compiler error block
- mask debug controls
- compact code panel

The UI should feel like a live code instrument. The shader source should be visible without turning the whole app into a chat interface.

### `server/planRoute.js`

Either:

- replace `/api/plan` with `/api/shader`, or
- split the server into a small router and mount `shaderRoute.js`.

For Phase 5, `/api/shader` is the primary endpoint. `/api/plan` can be deleted or left unused during transition, but it should not be part of the Phase 5 product plan.

### `analysis/objectLocalCv.js`

Shaders need image-like inputs, not only geometry arrays.

Add or expose:

```js
{
  edgeMaskCanvas,
  localEdges,
  localLines,
  ...
}
```

If object-local edge masks are too expensive at first, start with one scene-level Canny edge mask for the full frame. That still satisfies the Phase 5 requirement: OpenCV output becomes shader input.

### `analysis/foregroundBackground.js`

Ensure the foreground mask is available as a stable canvas source for WebGL upload.

Needed output:

```js
{
  foregroundMaskCanvas,
  foregroundMask,
  ready
}
```

The shader renderer should be able to upload the canvas directly to `u_fgMask`.

### `analysis/sceneSignals.js`

Keep using scene signals for prompt context:

- detected classes
- object count
- largest object
- selected object
- person/device presence
- mask availability

The LLM does not need camera pixels. It needs a concise scene summary and the shader contract.

## 12. ShaderPlan Format

Use a separate schema from `ActionPlan`.

```json
{
  "title": "Thermal Edge Ghost",
  "description": "Moving foreground becomes thermal color and OpenCV edges glow green.",
  "fragmentShader": "precision mediump float; ...",
  "uniforms": {
    "intensity": 0.85
  }
}
```

Recommended caps:

- Max prompt length: `500`
- Max title length: `48`
- Max description length: `160`
- Max fragment shader size: `16 KB`
- Max total serialized shader plan size: `24 KB`
- Max compile attempts per user action: `1`
- Max object uniforms: `16`

Validation should keep the previous working shader on failure.

## 13. Shader LLM Prompt Rules

The shader system prompt should say:

- Return only JSON.
- Generate only GLSL ES 1.00 fragment shader code.
- Do not include JavaScript, HTML, CSS, markdown, or explanations.
- Use only the provided uniforms.
- Include `precision mediump float`.
- Include `varying vec2 v_uv`.
- Include a `void main()` function.
- Use `texture2D`, not newer GLSL functions like `texture`.
- Do not use unsupported extensions.
- Keep loops small and constant-bound.
- Avoid expensive nested loops.
- Always sample `u_video`.
- Use `u_fgMask` when the prompt mentions foreground, body, person, silhouette, motion, ghost, thermal, infrared, or background separation.
- Use `u_edgeMask` when the prompt mentions edge, outline, contour, scan, sketch, glow, electric, wireframe, or drawing.
- Prefer combining `u_fgMask` and `u_edgeMask` because Phase 5 is explicitly about OpenCV-guided shaders.

The user message should include:

- user prompt
- detected classes
- largest object
- selected object summary
- object count
- available uniforms
- foreground mask availability
- edge mask availability
- current shader title

It should not send camera pixels.

## 14. Safety And Failure Handling

Generated shader code can fail to compile. That should be visible, not fatal.

Required handling:

- Compile in WebGL before activating.
- Keep `lastGoodProgram`.
- If compile fails, show the compiler log.
- Keep rendering the previous good shader or the OpenCV-aware default shader.
- Cap shader length.
- Cap object uniform count.
- Cap texture dimensions to current canvas size.
- Avoid dynamic user-defined uniform names in the first version.
- Never `eval`.
- Never generate or run JavaScript.

Validator checks:

- Reject strings containing `<script`, `fetch(`, `XMLHttpRequest`, `import`, `document.`, `window.`, `eval(`.
- Reject shader text without `void main`.
- Reject shader text without `u_video`.
- Warn or reject shader text that uses neither `u_fgMask` nor `u_edgeMask`.
- Reject shader text that appears to be markdown-only.
- Strip code fences if present.

The real containment is that the browser only compiles GLSL as a shader.

## 15. OpenCV Texture Bridge

Phase 5 begins here. The first rendering milestone must already connect OpenCV outputs to the shader.

### 15.1 Video Texture

Source:

```txt
captureCanvas
```

Uniform:

```glsl
uniform sampler2D u_video;
```

### 15.2 Foreground Mask Texture

Source:

```txt
analysis/foregroundBackground.js
```

Uniforms:

```glsl
uniform sampler2D u_fgMask;
uniform float u_hasFgMask;
```

Use cases:

- thermal body
- ghost silhouette
- separate person from room
- dim background
- motion aura
- foreground-only material changes

### 15.3 Edge Mask Texture

Source:

```txt
analysis/objectLocalCv.js
```

or a new full-frame OpenCV edge analysis helper.

Uniforms:

```glsl
uniform sampler2D u_edgeMask;
uniform float u_hasEdgeMask;
```

Use cases:

- glowing outlines
- scan lines catching object contours
- electric edge effects
- sketch/blueprint looks
- contour-driven displacement

### 15.4 Depth/Material Texture

Depth/material maps are useful, but they are not required for the first milestone.

Future uniform:

```glsl
uniform sampler2D u_depthMap;
uniform float u_hasDepthMap;
```

Use cases:

- fossil/relic material
- heat maps
- topographic effects
- fluid displacement

## 16. Object Uniform Bridge

After the OpenCV mask shader path works, add tracked object uniforms.

Normalize boxes into UV coordinates:

```js
const [x, y, w, h] = object.bbox;
u_objectBoxes[i] = [
  x / canvasWidth,
  y / canvasHeight,
  w / canvasWidth,
  h / canvasHeight
];
```

Future shader contract:

```glsl
const int MAX_OBJECTS = 16;

uniform int u_objectCount;
uniform vec4 u_objectBoxes[MAX_OBJECTS];
uniform float u_objectScores[MAX_OBJECTS];
uniform float u_selectedObjectIndex;
```

The shader can test whether a pixel is inside a box:

```glsl
float insideBox(vec2 uv, vec4 box) {
  vec2 minB = box.xy;
  vec2 maxB = box.xy + box.zw;
  vec2 inside = step(minB, uv) * step(uv, maxB);
  return inside.x * inside.y;
}
```

This enables prompts like:

- "make the largest object pulse"
- "draw a field around every detected object"
- "make the selected object radioactive"

Class-specific behavior should initially be handled by prompt context and object ordering rather than GLSL strings.

## 17. Implementation Milestones

There is no video-only Phase 5A. The first milestone is OpenCV-aware.

### Milestone 1: OpenCV-Aware Shader Renderer

Goal: prove that WebGL can render the live camera/video frame using OpenCV-derived masks.

Add:

- WebGL full-screen shader renderer.
- OpenCV-aware default shader.
- `u_video` texture upload.
- `u_fgMask` texture upload.
- `u_edgeMask` texture upload.
- mask availability uniforms.
- manual shader compile/apply.
- shader editor UI.
- compiler error display.

Done when:

- A shader can color only moving foreground.
- A shader can glow along OpenCV edges.
- A shader can dim or distort background separately from foreground.
- User can edit shader code and recompile it.
- Invalid shaders show errors without crashing.

### Milestone 2: Prompt-To-Shader

Goal: let the AI generate the OpenCV-aware shader.

Add:

- `llm/validateShaderPlan.js`.
- `llm/shaderPrompt.js`.
- `llm/shaderClient.js`.
- `/api/shader`.
- prompt submission branch in `app.js`.
- generated shader source inserted into the editor.
- generated shader compile/apply flow.

Done when:

- User prompt returns a complete GLSL fragment shader.
- The shader references `u_video` and at least one OpenCV mask input.
- The generated code is visible and editable.
- Failed compile keeps the last working shader active.

### Milestone 3: Object-Aware Shader Uniforms

Goal: let generated shaders respond to tracked objects.

Add:

- `u_objectCount`.
- `u_objectBoxes[MAX_OBJECTS]`.
- `u_objectScores[MAX_OBJECTS]`.
- `u_selectedObjectIndex`.
- largest-object metadata in prompt context.
- selected-object metadata in prompt context.

Done when:

- Shader can highlight the largest object.
- Shader can treat selected object differently.
- Shader can create fields around object boxes.
- Shader still compiles when no objects are detected.

### Milestone 4: Depth/Material Shader Inputs

Goal: add richer OpenCV/computer-vision textures beyond foreground and edges.

Add:

- `u_depthMap` or pseudo-depth/material texture.
- `u_hasDepthMap`.
- debug shader for depth/material map.
- prompt guidance for heatmap, fossil, terrain, topographic, and relief effects.

Done when:

- Generated shader can combine video, foreground mask, edge mask, and depth/material map.
- User can prompt for material transformations that are visibly different from edge/foreground effects.

### Milestone 5: Remove Or Quarantine Legacy ActionPlan UI

Goal: make the Phase 5 product surface match the shader-first architecture.

Remove or hide:

- preset row
- preset keyboard shortcuts
- `ActionPlan` inspector labels
- `JSON` plan copy/apply controls
- user-facing plan source badges
- `requestActionPlan()` prompt path

Keep only if useful internally:

- old action renderer files as archived/reference code
- old validators as examples for shader validation style
- old docs as history

Done when:

- The app launches into shader-first OpenCV rendering.
- The prompt produces shader code, not action plans.
- The editable artifact is GLSL, not plan JSON.

## 18. Recommended Build Order

1. Add `render/shader/defaultShaders.js` with the OpenCV-aware default shader.
2. Add `render/shader/shaderRenderer.js`.
3. Add `render/shader/shaderTextures.js`.
4. Expose or add a foreground mask canvas from `analysis/foregroundBackground.js`.
5. Expose or add an edge mask canvas from OpenCV/Canny.
6. Wire shader renderer into the `app.js` frame loop.
7. Draw the WebGL canvas into the existing `output` canvas.
8. Replace the plan inspector with a shader editor.
9. Add manual shader compile/apply with visible errors.
10. Add `llm/validateShaderPlan.js`.
11. Add `llm/shaderPrompt.js`.
12. Add `/api/shader`.
13. Add `llm/shaderClient.js`.
14. Route prompt submission to shader generation.
15. Add object box uniforms.
16. Add depth/material texture.
17. Remove or hide legacy preset/action-plan UI.
18. Update README and presentation materials.

This order starts directly with OpenCV as shader input, then adds AI generation once the shader/mask path is real.

## 19. Demo Narrative

The Phase 5 presentation should say:

> Phase 4 made the AI an art director choosing from our predefined visual vocabulary. Phase 5 replaces that with AI-authored visual code. OpenCV extracts structure from the scene, then the AI writes the GLSL fragment shader that decides how those masks and pixels become the final image.

Suggested live demo sequence:

1. Open the app directly in shader mode.
2. Show foreground and edge mask debug views briefly.
3. Return to generated shader output.
4. Prompt: "turn the moving foreground into a thermal ghost and make object edges glow green."
5. Show the generated GLSL code.
6. Edit a color, threshold, or wave frequency manually.
7. Recompile and show the result changing live.
8. Introduce a small shader error.
9. Show compiler feedback and fallback to the last working shader.

This directly answers the critique that the AI was only selecting presets.

## 20. Definition Of Done

Phase 5 is complete when:

- The app has a shader-first rendering path.
- The app no longer depends on `ActionPlan` as the primary user-facing renderer.
- The LLM generates full GLSL fragment shader code from a prompt.
- The generated shader code is visible to the user.
- The user can edit the shader and rerender it.
- Compile errors are displayed without crashing the app.
- The previous working shader remains active after a failed compile.
- The shader samples the live webcam/video frame.
- The shader samples at least two OpenCV-derived inputs: foreground mask and edge mask.
- The shader can use tracked object boxes or selected-object metadata.
- The README explains that Phase 5 replaces AI-selected effects with AI-authored shaders.

## 21. Success Criteria

The project should no longer feel like a preset selector. It should feel like:

- a live camera instrument,
- with OpenCV as scene perception,
- object detection as semantic structure,
- AI-generated GLSL as creative code,
- and an editable shader script as the user's point of control.

The conceptual achievement:

```txt
camera pixels
  + OpenCV foreground mask
  + OpenCV edge mask
  + object tracking
  + user prompt
  + AI-authored fragment shader
    -> live generated visual world
```

