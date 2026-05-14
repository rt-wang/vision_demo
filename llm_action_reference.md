# LLM Action Reference

The full vocabulary the planner is allowed to choose from. Anything outside this list is rejected by `llm/validateActionPlan.js` before it ever reaches the renderer.

A returned `ActionPlan` has the shape:

```json
{
  "title": "short evocative phrase",
  "globalStyle": { ... },
  "objectRules": [
    { "selector": { ... }, "label": { ... }, "actions": [ ... ] }
  ]
}
```

The renderer matches each tracked object against every `objectRule` in order; matching rules contribute their actions, and the last matching rule wins on `label`.

---

## 1. Plan-level limits

Enforced by validation (`llm/validateActionPlan.js`):

| Limit | Value |
|---|---|
| Max object rules | 6 |
| Max actions per rule | 4 |
| Max label text | 32 chars |
| Max title text | 48 chars |
| Max prompt text | 500 chars |
| Max serialized plan | 12 KB |
| Numeric fields | clamped to `0..1` |
| RGB color channels | clamped to `0..255` |

Unknown fields are dropped. Unknown action/blend/label/palette names fall back to the action's default. Bad model output can't crash the renderer — the validator always returns a safe plan.

---

## 2. Global style

Applied once per frame across the whole canvas.

| Field | Type | Notes |
|---|---|---|
| `sourceOpacity` | `0..1` | How much of the raw camera feed shows through. `1` = fully visible, `0` = source hidden. |
| `tint` | `[r, g, b]` | RGB fill blended at 0.45 alpha. `[255,255,255]` = no tint. |
| `contrast` | `0..1` | `0.5` = neutral. Below dims, above hardens. |
| `saturation` | `0..1` | `0.5` = neutral. `0` = grayscale, `1` = oversaturated. |
| `grain` | `0..1` | Static noise overlay strength. |
| `trailLength` | `0..1` | Legacy global trail field. Per-rule `trail` actions are preferred. |
| `blendMode` | enum | One of `normal`, `screen`, `multiply`, `difference`, `overlay`. |

---

## 3. Selectors

`objectRules[i].selector` chooses which tracked objects the rule targets.

| Field | Type | Notes |
|---|---|---|
| `classes` | `string[]` | COCO class names (`person`, `laptop`, `cell phone`, `tv`, …). Omit or empty = fallback rule that matches every object. Unknown class names are filtered out. |
| `selectedOnly` | `bool` | Only the user-selected object (when one exists). |
| `minScore` | `0..1` | Minimum detection confidence. |
| `largestOnly` | `bool` | Only the object with the highest `areaNorm`. |

---

## 4. Label modes

`objectRules[i].label.mode` controls per-object text overlays.

| Mode | Behavior |
|---|---|
| `literal` | Draws `class · NN%`. |
| `poetic` | Draws `label.text` (≤32 chars). If text missing, falls back to class name. |
| `hidden` | No label. |

---

## 5. Actions

All numeric fields clamp to `0..1`. All color fields clamp per-channel to `0..255`. Defaults below are what the validator fills in when a field is missing or unknown.

### `localEdges`

Canny edge overlay inside each matched object's bbox, recolored and composited with a glow.

| Field | Default | Notes |
|---|---|---|
| `opacity` | 0.7 | Layer alpha. |
| `glow` | 0.35 | Halo blur radius (scaled with `thickness`). |
| `color` | `[126,240,197]` | Tint of the edge mask. |
| `thickness` | 0.25 | Second draw pass when above 0.4 for a thicker read. |

Use for: structure, electric outlines, blueprints, x-ray feel.

### `localLines`

Probabilistic Hough segments inside each bbox, drawn with stroke + jitter.

| Field | Default | Notes |
|---|---|---|
| `opacity` | 0.7 | |
| `color` | `[185,225,255]` | Stroke color (also used as shadow color). |
| `thickness` | 0.25 | Line width scaling. |
| `jitter` | 0.05 | Per-frame endpoint shake (`*8px`). |

Use for: hand-drawn / architectural / shaky-CCTV feel.

### `localDepth`

Pseudo-depth visualization inside each bbox. Bilateral filter + histogram equalize, then mapped through a 256-entry palette LUT.

| Field | Default | Notes |
|---|---|---|
| `opacity` | 0.7 | |
| `palette` | `"inferno"` | One of `inferno`, `bone`, `ocean`, `magma`. |
| `invert` | 0 | `>0.5` flips dark/bright. |
| `relief` | 0.4 | Above 0.05 adds a second `overlay`-blend pass for stronger 3D-ish read. |
| `glow` | 0.3 | Halo blur around the colormap. |
| `onlyForeground` | 0 | `>0.5` clips the colormap to the scene-level MOG2 motion silhouette — produces a thermal-imaging look that only colors moving body pixels. Falls back to full bbox if MOG2 hasn't warmed up. |

Use for: thermal, material, scan, fossil, relic, infrared, depth/heatmap prompts.

### `foregroundBackground`

Scene-level MOG2 motion segmentation. Outputs one full-frame foreground mask; the renderer tints the moving foreground and dims/recolors the static background. Deduped across matched objects (an empty-selector fallback rule still fires it).

| Field | Default | Notes |
|---|---|---|
| `opacity` | 0.65 | Foreground silhouette alpha (screen blend). |
| `foregroundColor` | `[126,240,197]` | Flat color the silhouette is painted with. |
| `backgroundOpacity` | 0.35 | Background-fill alpha. |
| `backgroundColor` | `[8,12,18]` | Background fill color. |
| `learningRate` | 0.04 | MOG2 adaptation speed. Low = stable, high = adapts fast. `0` = frozen background model. |
| `glow` | 0.25 | Foreground halo blur. |

Use for: motion-mask, moving-foreground vs static-background separation, silhouette-against-dimmed-room prompts.

### `freezeBox`

Pin each matched object's crop as a persistent memory tile that keeps drawing over the live frame. Per-object persistent canvas.

| Field | Default | Notes |
|---|---|---|
| `opacity` | 0.78 | |
| `decay` | 0.06 | Per-frame update rate. `0` = permanent freeze; `1` = effectively live. |
| `jitter` | 0.0 | Subtle live shake (`max(w,h)*0.08*jitter` pixels, time-driven). |
| `reframe` | 0.0 | Expands/contracts the drawn crop around the bbox center. Range scales up to ~1.6×. |
| `blendMode` | `"normal"` | One of `normal`, `screen`, `multiply`, `difference`, `overlay`. |

Reset when the plan changes, the camera resizes, or the object stops matching. Use for: held frames, captured, preserved, memory tiles, pinned, frozen, ghost prompts.

### `aura`

Soft additive radial glow centered on the bbox.

| Field | Default | Notes |
|---|---|---|
| `opacity` | 0.5 | |
| `color` | `[235,210,130]` | |
| `radius` | 0.35 | Glow falloff radius (scales with bbox size). |
| `pulse` | 0.2 | Time-driven sinusoidal radius modulation. |

Use for: warmth, sacred, witness, glow, halo prompts.

### `trail`

Persistent decaying motion smear over the bbox region. Batched once per frame across all objects (fade → paint per object → composite). One trail layer, averaged params across active trails.

| Field | Default | Notes |
|---|---|---|
| `opacity` | 0.45 | |
| `length` | 0.45 | Per-frame retention factor (`length*0.97` keep). |
| `smear` | 0.18 | Shadow blur on each deposit. |

Use for: motion, smear, ghost, after-image, phantom, dream prompts.

### `spotlight`

Darkens the frame everywhere except a soft circle around the bbox.

| Field | Default | Notes |
|---|---|---|
| `opacity` | 0.5 | Strength of the dim. |
| `backgroundDim` | 0.3 | How dark the surrounding frame becomes. |
| `feather` | 0.5 | Falloff softness from the bright spot. |

Use for: focus, spotlight, lone-subject prompts.

### `glitch`

Per-bbox RGB-shift / horizontal slice displacement effect.

| Field | Default | Notes |
|---|---|---|
| `opacity` | 0.55 | |
| `sliceAmount` | 0.4 | Number of horizontal slices. |
| `displacement` | 0.25 | How far slices shift per frame. |

Use for: broken, corrupted, poisoned, glitch, error prompts.

---

## 6. Allowed enums

| Enum | Values |
|---|---|
| `SUPPORTED_ACTIONS` | `localEdges`, `localLines`, `localDepth`, `foregroundBackground`, `freezeBox`, `aura`, `trail`, `spotlight`, `glitch` |
| `SUPPORTED_BLEND_MODES` | `normal`, `screen`, `multiply`, `difference`, `overlay` |
| `SUPPORTED_LABEL_MODES` | `literal`, `poetic`, `hidden` |
| `SUPPORTED_DEPTH_PALETTES` | `inferno`, `bone`, `ocean`, `magma` |

---

## 7. Scene signals (planner input only)

`analysis/sceneSignals.js` computes summaries from the tracker every frame. These are sent to the planner as context — the LLM never sees pixels.

| Field | Type | Notes |
|---|---|---|
| `objectCount` | int | Live (non-stale) detections. |
| `classes` | string[] | Unique class names currently detected. |
| `personCount` | int | Persons detected. |
| `deviceCount` | int | `laptop`, `cell phone`, `tv`, `keyboard`, `mouse`, `remote`. |
| `largestObjectClass` | string \| null | Class of the largest live object. |
| `largestObjectArea` | `0..1` | Normalized area of the largest object. |
| `averageMotion` | `0..1` | Mean object speed, capped. |
| `sceneCrowdedness` | `0..1` | `min(1, count/6)`. |
| `selectedObjectClass` | string \| null | If user has selected an object. |

The planner can use these to write rules like "if the largest object is a person, …" — but rule *selectors* themselves only look at `classes` / `selectedOnly` / `minScore` / `largestOnly`.

---

## 8. Render order

Fixed by `render/actionRenderer.js`. Same plan + same frame always produces the same output.

1. Source video (with `sourceOpacity`, `contrast`, `saturation` filter)
2. Global `tint` (with `blendMode`)
3. `foregroundBackground` (scene-level, deduped)
4. `trail` (batched once per frame, averaged params)
5. `freezeBox` (per matched object, pruned to live matches)
6. `localDepth`, `localEdges`, `localLines` (per matched object, geometry-dependent)
7. `spotlight`, `aura`, `glitch` (per matched object)
8. Labels
9. Grain + always-on vignette

---

## 9. What the LLM cannot do

The planner has expressive control, not execution control. It cannot:

- Generate JavaScript, shaders, CSS, or arbitrary text strings (beyond `title` and `label.text`).
- Invent new action types, blend modes, label modes, palettes, or selectors.
- Reach outside `0..1` numeric ranges or `0..255` color channels.
- Issue network requests, load models, or change pipeline structure.
- Target object classes outside the 80 COCO-SSD classes.

Anything outside the vocabulary above is silently dropped or replaced with safe defaults before the renderer sees the plan.
