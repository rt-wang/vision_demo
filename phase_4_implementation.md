# Phase 4 Implementation: LLM Action Planner

## 1. Goal

Phase 4 turns Latent Canvas from a preset-driven object visualizer into a prompt-directed object-local visual instrument.

The LLM should not choose arbitrary code, arbitrary shaders, or arbitrary CV pipelines. It should choose a validated `ActionPlan` from a safe vocabulary. The renderer remains deterministic and browser-native.

Current Phase 3 state:

- Object detection is the root analysis layer.
- Tracked objects drive all visual effects.
- Object-local CV currently provides local Canny edges and Hough lines.
- Four hardcoded presets exercise the renderer.
- The action renderer already accepts arbitrary `ActionPlan` objects.

Phase 4 replaces "pick one of four presets" with "generate a valid action plan from a prompt."

```txt
user prompt
  + detected object classes
  + scene signals
  + current plan
  + supported schema
    -> backend LLM planner
    -> validateActionPlan()
    -> current target ActionPlan
    -> styled renderer
```

## 2. Core Principle

The LLM gets expressive control, not execution control.

It can change:

- Which object classes are targeted.
- Which supported actions are applied.
- Action intensity and parameters.
- Colors, labels, blend modes, source opacity, grain, contrast, saturation.
- Whether labels are literal, poetic, or hidden.

It cannot change:

- JavaScript code.
- Canvas draw functions.
- OpenCV function calls directly.
- Model loading.
- Network URLs.
- Unsupported action types.
- Unbounded strings or raw CSS.

The creative range comes from composable safe actions, rich color/style parameters, and object-specific targeting.

## 3. Phase 4 Scope

### Phase 4A: Prompt-To-Plan With Existing Actions

Use the current action vocabulary:

- `localEdges`
- `localLines`
- `aura`
- `trail`
- `spotlight`
- `glitch`

Add:

- Prompt input UI.
- Backend LLM endpoint.
- `validateActionPlan()`.
- Current generated plan state.
- Fallback behavior if the LLM fails.

This proves the planner loop before adding new visual primitives.

### Phase 4B: Expand Vocabulary With High-Impact Actions

Add:

- `localDepth`
- `freezeBox`
- `foregroundBackground`

`localDepth` and `freezeBox` fit the object-local vision direction and create much more variety without making the LLM unsafe. `foregroundBackground` adds one scene-level CV action to the same safe vocabulary: OpenCV.js background subtraction extracts moving foreground from a learned static background, then the action renderer tints foreground and dims/tints background.

### Phase 4C: Better Prompt Context

Add scene/object summaries:

- Detected classes.
- Object counts.
- Largest object.
- Person/device presence.
- Average object motion.
- Current plan title.

The LLM should receive summaries, not camera pixels.

## 4. Files To Add

```txt
llm/
  validateActionPlan.js
  plannerPrompt.js
  planClient.js

server/
  planRoute.js

analysis/
  sceneSignals.js
  foregroundBackground.js

render/actions/
  localDepth.js
  freezeBox.js
  foregroundBackground.js
```

If the project stays fully static for now, `server/planRoute.js` can be a reference implementation while `planClient.js` uses a mocked planner or a user-pasted JSON plan. Real API keys should never live in browser code.

## 5. Files To Change

```txt
index.html
app.js
styles.css
llm/actionPlanSchema.js
llm/validateActionPlan.js
llm/plannerPrompt.js
llm/mockPlanner.js
analysis/objectLocalCv.js
render/actionRenderer.js
llm/defaultPlans.js
README.md
object-local-cv-design.md
```

Expected changes:

- Add prompt UI and generated-plan status.
- Store `currentPlan` separately from preset id.
- Run `drawStyledPlan()` with generated plans.
- Keep presets as examples/fallbacks.
- Add validation and schema constants.
- Add optional local-depth geometry.
- Add freeze-box persistent state.
- Add optional foreground/background scene mask.

## 6. Runtime State

Add these fields to `state` in `app.js`:

```js
{
  currentPlan: null,
  currentPlanSource: "preset" | "llm" | "neutral",
  promptText: "",
  planPending: false,
  lastPlanError: null,
  sceneSignals: null
}
```

Recommended behavior:

- `Neutral` remains available.
- Presets remain available as stable examples.
- A successful prompt creates an `llm` plan.
- If validation fails, keep the previous plan and show a compact error.
- Reset persistent action layers, such as trails and frozen boxes, when a new plan lands.

## 7. Prompt UI

Add a compact prompt bar to the existing lower control cluster.

Controls:

- Text input.
- Submit button.
- Optional "surprise" button later.
- Small status text: `planning`, `applied`, `invalid plan`, `offline`.

Example placeholder:

```txt
make the person sacred and the laptop poisonous
```

The prompt UI should not dominate the webcam. It should feel like live direction, not a chat app.

## 8. Scene Signals

Create `analysis/sceneSignals.js`.

```js
export function computeSceneSignals(objects) {
  const live = objects.filter((o) => !o.stale);
  const classes = [...new Set(live.map((o) => o.className))];
  const largest = live.reduce((best, o) => (o.areaNorm > (best?.areaNorm || 0) ? o : best), null);
  const avgMotion = live.length
    ? live.reduce((sum, o) => sum + Math.hypot(o.velocity[0], o.velocity[1]), 0) / live.length
    : 0;

  return {
    objectCount: live.length,
    classes,
    personCount: live.filter((o) => o.className === "person").length,
    deviceCount: live.filter((o) =>
      ["laptop", "cell phone", "tv", "keyboard", "mouse", "remote"].includes(o.className)
    ).length,
    largestObjectClass: largest?.className || null,
    largestObjectArea: largest?.areaNorm || 0,
    averageMotion: Math.min(1, avgMotion / 80),
    selectedObjectClass: live.find((o) => o.selected)?.className || null
  };
}
```

These signals are sent to the planner and can also be shown in an inspector later.

## 9. Planner Request

The browser should send:

```json
{
  "userPrompt": "make devices feel haunted and the person feel warm",
  "detectedClasses": ["person", "laptop", "chair"],
  "signals": {
    "objectCount": 3,
    "personCount": 1,
    "deviceCount": 1,
    "largestObjectClass": "person",
    "largestObjectArea": 0.31,
    "averageMotion": 0.12,
    "selectedObjectClass": null
  },
  "currentPlan": {},
  "supportedActions": [
    "localEdges",
    "localLines",
    "foregroundBackground",
    "aura",
    "trail",
    "spotlight",
    "glitch"
  ],
  "supportedBlendModes": ["normal", "screen", "multiply", "difference", "overlay"],
  "supportedLabelModes": ["literal", "poetic", "hidden"]
}
```

For the foreground/background slice of Phase 4B, `foregroundBackground` is the new supported action. It is scene-level: the analyzer computes one full-frame foreground mask per frame when any active rule includes this action, and the renderer deduplicates identical actions across matched objects.

```json
{
  "type": "foregroundBackground",
  "opacity": 0.78,
  "foregroundColor": [126, 240, 197],
  "backgroundOpacity": 0.42,
  "backgroundColor": [8, 12, 18],
  "learningRate": 0.04,
  "glow": 0.32
}
```

The full Phase 4B supported-action target is:

```json
[
  "localEdges",
  "localLines",
  "foregroundBackground",
  "aura",
  "trail",
  "spotlight",
  "glitch",
  "localDepth",
  "freezeBox"
]
```

## 10. Planner System Prompt

Create `llm/plannerPrompt.js`.

The system prompt should be strict:

```txt
You are the action planner for Latent Canvas, a live object-aware visual instrument.

Return only valid JSON matching the ActionPlan schema.
Do not include markdown.
Do not explain your choices.
Do not generate code.
Do not invent action types, blend modes, selectors, or fields.
Use only detected object classes unless writing a fallback rule with an empty selector.
If the prompt says "this", target selectedOnly only when a selected object exists.
All numeric values must be between 0 and 1.
RGB colors must be integer arrays like [255, 120, 40].
Keep objectRules concise: usually 1 to 4 rules.
Prefer combining 1 to 3 actions per rule.
Avoid making every action maximum intensity.
```

The user/developer payload should include the schema and examples.

## 11. Validation

Create `llm/validateActionPlan.js`.

Validation should:

1. Parse JSON if the planner returns a string.
2. Require an object root.
3. Sanitize `title`.
4. Fill missing `globalStyle` with defaults.
5. Clamp all numeric values to `0..1`.
6. Clamp RGB colors to `0..255`.
7. Reject unknown blend modes.
8. Reject unknown label modes.
9. Reject unknown action types.
10. Drop unknown fields.
11. Limit object rules, such as max `6`.
12. Limit actions per rule, such as max `4`.
13. Limit label text length, such as max `32`.
14. Keep only selector classes that are currently detected or known COCO classes.
15. Return `{ ok, plan, errors }`.

Important: validation should sanitize, not merely check. The renderer should only ever receive a validated plan.

### Suggested Normalized Action Defaults

```js
const ACTION_DEFAULTS = {
  localEdges: {
    opacity: 0.7,
    glow: 0.35,
    color: [126, 240, 197],
    thickness: 0.25
  },
  localLines: {
    opacity: 0.7,
    color: [185, 225, 255],
    thickness: 0.25,
    jitter: 0.05
  },
  foregroundBackground: {
    opacity: 0.65,
    foregroundColor: [126, 240, 197],
    backgroundOpacity: 0.35,
    backgroundColor: [8, 12, 18],
    learningRate: 0.04,
    glow: 0.25
  },
  aura: {
    opacity: 0.5,
    color: [235, 210, 130],
    radius: 0.35,
    pulse: 0.2
  },
  trail: {
    opacity: 0.45,
    length: 0.45,
    smear: 0.18
  },
  spotlight: {
    opacity: 0.5,
    backgroundDim: 0.3,
    feather: 0.5
  },
  glitch: {
    opacity: 0.55,
    sliceAmount: 0.4,
    displacement: 0.25
  }
};
```

## 12. Example Valid Plan

```json
{
  "title": "Soft Machine Weather",
  "globalStyle": {
    "sourceOpacity": 0.68,
    "tint": [140, 190, 255],
    "contrast": 0.54,
    "saturation": 0.42,
    "grain": 0.14,
    "trailLength": 0,
    "blendMode": "screen"
  },
  "objectRules": [
    {
      "selector": {
        "classes": ["person"],
        "minScore": 0.4
      },
      "label": {
        "mode": "poetic",
        "text": "warm witness"
      },
      "actions": [
        {
          "type": "aura",
          "opacity": 0.68,
          "color": [255, 205, 145],
          "radius": 0.36,
          "pulse": 0.24
        },
        {
          "type": "spotlight",
          "opacity": 0.44,
          "backgroundDim": 0.26,
          "feather": 0.58
        }
      ]
    },
    {
      "selector": {
        "classes": ["laptop", "cell phone", "tv"],
        "minScore": 0.35
      },
      "label": {
        "mode": "poetic",
        "text": "cold signal"
      },
      "actions": [
        {
          "type": "glitch",
          "opacity": 0.72,
          "sliceAmount": 0.56,
          "displacement": 0.34
        },
        {
          "type": "localEdges",
          "opacity": 0.88,
          "glow": 0.62,
          "color": [90, 255, 185],
          "thickness": 0.36
        }
      ]
    }
  ]
}
```

## 13. Backend Route

Create `server/planRoute.js` as the reference backend.

Recommended endpoint:

```txt
POST /api/plan
```

Request:

```json
{
  "userPrompt": "...",
  "detectedClasses": ["person", "laptop"],
  "signals": {},
  "currentPlan": {},
  "supportedActions": []
}
```

Response:

```json
{
  "ok": true,
  "plan": {},
  "errors": []
}
```

Failure response:

```json
{
  "ok": false,
  "plan": null,
  "errors": ["invalid_json"]
}
```

Backend responsibilities:

- Hold the API key.
- Call the LLM.
- Validate the model output.
- Return only the validated plan.

Browser responsibilities:

- Send prompt context.
- Apply validated plan.
- Keep previous plan on failure.

## 14. Frontend Plan Client

Create `llm/planClient.js`.

```js
export async function requestActionPlan(payload) {
  const res = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`planner failed: ${res.status}`);
  const json = await res.json();
  if (!json.ok || !json.plan) {
    throw new Error((json.errors || ["invalid plan"]).join(", "));
  }
  return json.plan;
}
```

For a static-only demo, add a temporary local planner:

```js
export function mockPlanFromPrompt(prompt, context) {
  // Keyword-based fallback for local testing only.
}
```

This lets the UI and renderer integration be built before a backend exists.

## 15. App Integration

In `app.js`:

1. Import `computeSceneSignals()`.
2. Import `requestActionPlan()`.
3. Compute scene signals after tracker update.
4. Add prompt submit handler.
5. On submit, build planner payload.
6. Await validated plan.
7. Set `state.currentPlan`.
8. Set `state.currentPlanSource = "llm"`.
9. Update `planTitle`.
10. Reset persistent effects.

Rendering decision:

```js
const activePlan =
  state.currentPlanSource === "llm"
    ? state.currentPlan
    : findPreset(state.presetId).plan;
```

If `activePlan` exists and intensity is above threshold, call `drawStyledPlan()`. Otherwise use neutral preview.

## 16. Phase 4B: `localDepth`

### Why

Depth inside an object box feels like a new kind of material, not just another color variant. It fits the original Latent Canvas idea: object detection chooses attention, local CV invents visual structure inside that attention.

### Schema

```ts
{
  type: "localDepth";
  opacity: number;
  palette: "inferno" | "bone" | "ocean" | "magma";
  invert: number;
  relief: number;
  glow: number;
}
```

Because palette is an enum, validation must reject unknown palette names.

### Analysis

Extend `computeObjectGeometry()`:

- Convert ROI to grayscale.
- Apply bilateral filter.
- Equalize histogram.
- Optionally invert in renderer or analysis.
- Apply OpenCV colormap.
- Store as `localDepthImage`.

```ts
type ObjectGeometry = {
  localEdges?: ImageData;
  localLines?: Array<[number, number, number, number]>;
  localDepthImage?: ImageData;
  localEdgesOrigin?: [number, number];
};
```

### Renderer

Add `render/actions/localDepth.js`.

Draw the image at bbox origin:

- Use `globalAlpha = opacity * intensity`.
- Use `screen`, `overlay`, or `source-atop` depending on desired look.
- Add optional glow by shadow blur.

## 17. Phase 4B: `freezeBox`

### Why

Freezing an object box creates a strong live-performance move: the object becomes a memory tile, a held frame, or a pinned artifact while the world keeps moving.

### Schema

```ts
{
  type: "freezeBox";
  opacity: number;
  decay: number;
  jitter: number;
  reframe: number;
  blendMode: "normal" | "screen" | "multiply" | "difference" | "overlay";
}
```

### Behavior

For each matched object:

- Capture its current crop into a persistent offscreen canvas.
- Keep drawing that frozen crop over the live frame.
- `decay` controls how quickly the frozen image fades or updates.
- `jitter` offsets the frozen image slightly.
- `reframe` expands or contracts the drawn crop.

### State

`freezeBox` needs persistent state like `trail`.

```txt
render/actions/freezeBox.js
  captureFrozenBox()
  applyFreezeBox()
  resetFrozenBoxes()
```

Reset frozen boxes when:

- The active plan changes.
- The camera size changes.
- The object disappears for too long.

## 18. Phase 4B: `foregroundBackground`

### Why

Foreground/background separation gives the planner one action that can affect the whole scene while still staying inside a fixed safe vocabulary. It lets prompts like "separate me from the room" or "make the moving foreground radioactive" produce a strong visual change without allowing arbitrary segmentation code.

This follows the OpenCV background-subtraction pattern: keep a background-subtractor object alive across frames, feed each frame to `apply()`, and render the resulting foreground mask.

### Schema

```ts
{
  type: "foregroundBackground";
  opacity: number;
  foregroundColor: [number, number, number];
  backgroundOpacity: number;
  backgroundColor: [number, number, number];
  learningRate: number;
  glow: number;
}
```

All numbers are clamped to `0..1`; RGB arrays are clamped to `0..255`.

`learningRate` maps directly to OpenCV's `apply(..., learningRate)` value. Low values keep the learned background stable; high values adapt quickly.

### Analysis

Create `analysis/foregroundBackground.js`.

Use OpenCV.js:

```js
const subtractor = new cv.BackgroundSubtractorMOG2(500, 16, false);
subtractor.apply(src, fgmask, learningRate);
```

Implementation details:

- Keep one `BackgroundSubtractorMOG2` instance alive across frames.
- Recreate the subtractor if the camera size changes.
- Read `captureCanvas` into a Mat only when the active plan includes `foregroundBackground`.
- Threshold the output mask to binary.
- Apply a small morphological open + close pass to reduce webcam noise.
- Return a scene-level mask, not object-local geometry.

```ts
type ForegroundBackgroundGeometry = {
  foregroundMask: ImageData;
};
```

Reset the subtractor when:

- The active plan changes.
- The camera size changes.
- The OpenCV module is disposed/reloaded.

### Renderer

Add `render/actions/foregroundBackground.js`.

Render order:

- Draw source + global tint.
- Apply `foregroundBackground`.
- Draw trails.
- Draw object-local edges/lines.
- Draw spotlight/aura/glitch, labels, grain.

Because the mask is scene-level, `actionRenderer` should deduplicate identical `foregroundBackground` actions across matched objects. A fallback rule with an empty selector can still trigger it, but it should render once per distinct action.

Rendering behavior:

- Tint/dim background by filling the frame with `backgroundColor`, cutting the foreground mask out, and compositing at `backgroundOpacity * intensity`.
- Tint foreground by recoloring the mask with `foregroundColor`, then draw it with `screen` blend at `opacity * intensity`.
- Use `glow` as a shadow blur around the foreground pass.

## 19. Color Variety

The current implementation already permits arbitrary RGB colors. The limitation is not technical, it is prompt/schema guidance.

Improve variety by giving the LLM named palette hints that compile down to RGB:

```js
const PALETTE_HINTS = {
  sacred: [[235, 210, 130], [255, 245, 210], [140, 110, 60]],
  radioactive: [[90, 255, 150], [180, 255, 80], [20, 60, 35]],
  cold: [[120, 170, 255], [205, 235, 255], [40, 55, 90]],
  violent: [[255, 70, 60], [255, 180, 120], [80, 0, 20]],
  archival: [[220, 190, 140], [120, 100, 80], [40, 34, 28]],
  synthetic: [[255, 80, 220], [70, 240, 255], [40, 20, 80]]
};
```

Do not expose palette names as renderer inputs unless desired. The LLM can simply use these as examples and still return RGB arrays.

## 20. Safety Limits

Recommended caps:

- Max object rules: `6`
- Max actions per rule: `4`
- Max label length: `32`
- Max prompt length: `500`
- Max generated title length: `48`
- Max total serialized plan size: `12 KB`

Renderer fallback:

- Unknown action: skip.
- Missing geometry: skip geometry-dependent action.
- Empty rules: draw neutral preview or a mild global style.
- Planner timeout: keep current plan.

## 21. Definition Of Done

Phase 4A is done when:

- User can type a prompt.
- The app sends object context to a planner endpoint or mock planner.
- A validated `ActionPlan` replaces the active preset.
- The generated plan can target detected classes.
- The generated plan can vary color, labels, actions, opacity, intensity, and blend mode.
- Bad model output cannot crash the app.
- Presets still work as examples/fallbacks.

Phase 4B is done when:

- `localDepth` can be applied inside object boxes.
- `freezeBox` can hold object crops as persistent artifacts.
- `foregroundBackground` can separate moving foreground from learned background with OpenCV.js MOG2.
- All three 4B actions are included in validation and prompt schema.
- The LLM can choose them from natural language.

Phase 4C is done when:

- Scene signals are included in the prompt payload.
- Prompts like "make the largest object a relic" or "make devices poisonous" work reliably.

## 22. Recommended Build Order

1. Implement `validateActionPlan()`.
2. Add prompt UI and a local mock planner.
3. Wire `currentPlan` into `app.js`.
4. Add scene signals.
5. Add backend route.
6. Replace mock planner with real endpoint.
7. Add `foregroundBackground`.
8. Add `localDepth`.
9. Add `freezeBox`.
10. Update docs and README.

This keeps the risk low: first prove arbitrary validated plans, then add richer actions.
