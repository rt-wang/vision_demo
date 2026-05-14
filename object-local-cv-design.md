# Latent Canvas: Object-First Creative Vision Design

## 1. Direction

Latent Canvas should stop behaving like a mode switcher and start behaving like a live object-aware visual instrument.

The first version should use object detection as the default and only analysis root. Instead of switching between lines, depth, objects, and segmentation as separate modes, the app should:

1. Detect objects in the webcam frame.
2. Treat each detected object as a local canvas.
3. Run computer vision effects inside or around those object regions.
4. Let an LLM choose a safe set of creative actions from the user's prompt.
5. Render those actions deterministically in the browser.

The LLM does not generate pixels or code. It chooses from a constrained action vocabulary and style schema.

```txt
webcam frame
  -> object detection
  -> tracked object regions
  -> object-local cv
  -> scene signals
  -> user prompt + signals
  -> LLM action/style plan
  -> deterministic renderer
```

## 2. Product Shape

The webcam remains the main surface. There should be no separate mode dock for lines, depth, objects, or segmentation.

The primary controls become:

- Prompt input
- Preview/styled toggle
- Object lock/select
- Intensity slider
- Optional inspector for current objects and generated action plan

Default boot state:

- Camera opens.
- COCO-SSD starts detecting objects.
- Neutral object preview appears immediately.
- User can type a prompt such as "make the laptop feel radioactive and the person feel sacred."
- The LLM returns a structured plan using supported actions.
- The renderer applies that plan to detected objects.

## 3. Core Objects

Each detection should become a richer tracked object, not just a bounding box.

```ts
type DetectedObject = {
  id: string;
  className: string;
  score: number;
  bbox: [number, number, number, number];
  center: [number, number];
  areaNorm: number;
  ageMs: number;
  lastSeenMs: number;
  velocity: [number, number];
  selected: boolean;
};
```

The app also computes scene-level signals.

```ts
type ObjectSceneSignals = {
  objectCount: number;
  personCount: number;
  largestObjectArea: number;
  averageMotion: number;
  sceneCrowdedness: number;
  selectedObjectClass?: string;
};
```

## 4. Object-Local CV

Object-local CV means running visual analysis on cropped object regions instead of the whole frame.

Supported local analyses for the first version:

- `localEdges`: Canny edge mask inside the object bbox.
- `localLines`: Hough line segments inside the object bbox.
- `localContours`: simplified contour outlines inside the object bbox.
- `localMotion`: frame differencing inside the object bbox.
- `objectAura`: expanded bbox region used for halos, glows, fields, and shadows.

The important shift: object detection decides where attention goes; CV decides what geometry inside that attention field becomes visible.

```ts
type ObjectGeometry = {
  objectId: string;
  localEdges?: ImageData;
  localLines?: Array<[number, number, number, number]>;
  localContours?: Array<Array<[number, number]>>;
  localMotionAmount: number;
};
```

## 5. LLM Role

The LLM is an art director and action router.

Input to the LLM:

- User prompt
- Current detected object classes
- Optional selected object
- Scene signals
- Current style/action state
- Supported action schema

Output from the LLM:

- A short title for the current treatment
- Target object selectors
- Allowed creative actions
- Style parameters
- Optional poetic labels

The LLM must not:

- Generate executable code
- Invent unsupported actions
- Change the model pipeline directly
- Request raw image access

## 6. Action Plan Schema

```ts
type ActionPlan = {
  title: string;
  globalStyle: {
    sourceOpacity: number;
    tint: [number, number, number];
    contrast: number;
    saturation: number;
    grain: number;
    trailLength: number;
    blendMode: "normal" | "screen" | "multiply" | "difference" | "overlay";
  };
  objectRules: ObjectRule[];
};

type ObjectRule = {
  selector: {
    classes?: string[];
    selectedOnly?: boolean;
    minScore?: number;
    largestOnly?: boolean;
  };
  label?: {
    mode: "literal" | "poetic" | "hidden";
    text?: string;
  };
  actions: CreativeAction[];
};

type CreativeAction =
  | {
      type: "localEdges";
      opacity: number;
      glow: number;
      color: [number, number, number];
      thickness: number;
    }
  | {
      type: "localLines";
      opacity: number;
      color: [number, number, number];
      thickness: number;
      jitter: number;
    }
  | {
      type: "foregroundBackground";
      opacity: number;
      foregroundColor: [number, number, number];
      backgroundOpacity: number;
      backgroundColor: [number, number, number];
      learningRate: number;
      glow: number;
    }
  | {
      type: "aura";
      opacity: number;
      color: [number, number, number];
      radius: number;
      pulse: number;
    }
  | {
      type: "trail";
      opacity: number;
      length: number;
      smear: number;
    }
  | {
      type: "spotlight";
      opacity: number;
      backgroundDim: number;
      feather: number;
    }
  | {
      type: "glitch";
      opacity: number;
      sliceAmount: number;
      displacement: number;
    };
```

All numbers are clamped from `0` to `1`. Colors are RGB integers from `0` to `255`.

## 7. AI Features

### Feature A: Prompt-To-Action Routing

The user writes an abstract prompt. The LLM chooses which supported object-local actions to apply.

Example:

```txt
make the laptop feel radioactive and the person feel sacred
```

Possible result:

- `laptop`: glitch + green aura + localEdges
- `person`: gold aura + spotlight + poetic label
- global: lower source opacity, warmer contrast

### Feature B: Semantic Object Styling

Different object classes receive different treatments.

Examples:

- `person` -> aura, spotlight, poetic label
- `cell phone` -> glitch, displacement, hard edges
- `laptop` -> localLines, scan effects, cold tint
- `chair` -> contour outline, dim label, low opacity

This gives the LLM room to interpret meaning while the renderer stays deterministic.

### Feature C: Poetic Relabeling

The LLM can rename object labels without changing detection results.

Examples:

- `person` -> `witness`
- `laptop` -> `oracle`
- `cell phone` -> `black mirror`
- `chair` -> `empty throne`

This should be optional and visible only in styled mode. Neutral preview should keep literal labels.

### Feature D: Object Selection Intent

If the user clicks an object, prompts can target the selected object.

Examples:

- "make this dissolve"
- "turn this into the center of gravity"
- "hide everything except this"

The LLM receives `selectedObjectClass` and returns rules with `selectedOnly: true`.

## 8. Rendering Modes

### Neutral Preview

The neutral preview is for inspection.

- Draw source video normally.
- Draw object boxes.
- Draw literal labels and confidence.
- Optionally show faint local CV geometry inside boxes.
- Do not use poetic labels or heavy effects.

### Styled Render

Styled render applies the current `ActionPlan`.

- Draw source video with global style.
- Match each detected object against object rules.
- Run the required object-local CV analyses.
- Run scene-level foreground/background subtraction only when an action asks for it.
- Render actions in stable order:
  1. Source video
  2. Background dim/tint
  3. Foreground/background masks
  4. Trails
  5. Object-local edges/lines/contours
  6. Aura/spotlight/glitch
  7. Labels
  8. Grain/vignette

## 9. Phased Build Plan

### Phase 1: Object-First Refactor

Goal: remove mode switching and make object detection the root analysis layer.

Work:

- Remove the Lines, Depth, Objects, and Segment mode dock.
- Load only TensorFlow.js and COCO-SSD.
- Rename `ObjectsMode` into an object analysis/render module.
- Always run object detection after camera boot.
- Render neutral object preview by default.
- Add object IDs and simple tracking across frames.

Done when:

- The app opens directly into object detection.
- Boxes and labels are stable enough to feel trackable.
- There is no visible multi-mode UI.

### Phase 2: Object-Local CV Layer

Goal: make detected boxes into local analysis regions.

Work:

- Keep OpenCV.js.
- For each tracked object, crop the bbox from the capture canvas.
- Run local Canny edges inside the crop.
- Add local Hough lines inside the crop.
- Convert local geometry back into full-canvas coordinates.
- Cache/reuse Mats to avoid unnecessary allocations.

Done when:

- Each object can display its own edge/line geometry.
- The background is not analyzed unless an action asks for it.
- Object-local geometry follows moving objects.

### Phase 3: Deterministic Creative Actions

Goal: create the action vocabulary before connecting the LLM.

Work:

- Implement `aura`, `localEdges`, `localLines`, `trail`, `spotlight`, and `glitch`.
- Add a local hardcoded `ActionPlan` preset switcher for testing.
- Add smooth interpolation for style/action intensity.
- Add a global intensity slider.

Done when:

- The same detected objects can look meaningfully different across presets.
- Actions compose cleanly without needing AI.
- Performance remains interactive.

### Phase 4: LLM Action Planner

Goal: let prompts choose from the safe action vocabulary.

Work:

- Add a backend endpoint for prompt-to-action-plan.
- Send prompt, detected object classes, selected object, signals, current plan, and supported schema.
- Validate the returned JSON.
- Clamp all values.
- Reject unknown actions and blend modes.
- Keep the previous plan if validation fails.

Done when:

- A prompt changes object treatments without reloading the camera.
- The LLM can target object classes and selected objects.
- Invalid model output cannot break the renderer.

### Phase 5: Object Selection And Performance Polish

Goal: make the tool feel playable.

Work:

- Add click-to-select object.
- Add selected-object visual affordance.
- Add prompt shortcuts: "this", "everything else", "the largest object".
- Run object detection at a capped rate, such as 8-12 FPS.
- Run object-local CV only for objects used by the current action plan.
- Add a compact inspector for current objects, signals, and active plan.

Done when:

- The user can point the AI at a specific object.
- Prompt refinement feels live.
- The system avoids wasting CV work on unused regions.

### Phase 6: Scene Relationships

Goal: make the canvas respond to object relationships, not only individual objects.

Work:

- Compute object distance and proximity.
- Add line/ray connections between matched objects.
- Add rules such as `largestOnly`, `newObjectsOnly`, and `nearClass`.
- Let the LLM choose relationship actions from a schema.

Possible actions:

- Draw tension lines between people and devices.
- Pulse when a selected object approaches another object.
- Dim everything except the largest object.
- Create a field around clusters of objects.

Done when:

- The demo can respond to the arrangement of the scene.
- Object detection feels compositional, not only classificatory.

## 10. Example LLM Prompt Contract

System instruction:

```txt
You are the art director for Latent Canvas.

Translate the user's visual prompt into a valid ActionPlan JSON object.
Choose only from the supported actions.
Do not generate code.
Do not explain your answer.
Do not modify the analysis pipeline.
Use the available detected object classes and scene signals.
If the user says "this", target the selected object.
All numbers must be between 0 and 1.
Return only JSON.
```

Request payload:

```json
{
  "userPrompt": "make the person sacred and the laptop poisonous",
  "detectedClasses": ["person", "laptop", "chair"],
  "selectedObjectClass": null,
  "signals": {
    "objectCount": 3,
    "personCount": 1,
    "largestObjectArea": 0.34,
    "averageMotion": 0.18,
    "sceneCrowdedness": 0.42
  },
  "supportedActions": ["localEdges", "localLines", "foregroundBackground", "aura", "trail", "spotlight", "glitch"]
}
```

Example response:

```json
{
  "title": "Sacred Contamination",
  "globalStyle": {
    "sourceOpacity": 0.72,
    "tint": [190, 210, 180],
    "contrast": 0.62,
    "saturation": 0.45,
    "grain": 0.16,
    "trailLength": 0.22,
    "blendMode": "screen"
  },
  "objectRules": [
    {
      "selector": {
        "classes": ["person"],
        "minScore": 0.5
      },
      "label": {
        "mode": "poetic",
        "text": "witness"
      },
      "actions": [
        {
          "type": "aura",
          "opacity": 0.85,
          "color": [235, 210, 130],
          "radius": 0.42,
          "pulse": 0.18
        },
        {
          "type": "spotlight",
          "opacity": 0.7,
          "backgroundDim": 0.32,
          "feather": 0.65
        }
      ]
    },
    {
      "selector": {
        "classes": ["laptop"],
        "minScore": 0.45
      },
      "label": {
        "mode": "poetic",
        "text": "poison engine"
      },
      "actions": [
        {
          "type": "glitch",
          "opacity": 0.78,
          "sliceAmount": 0.48,
          "displacement": 0.34
        },
        {
          "type": "localEdges",
          "opacity": 0.9,
          "glow": 0.56,
          "color": [90, 255, 150],
          "thickness": 0.32
        }
      ]
    }
  ]
}
```

## 11. Suggested File Structure

```txt
vision_demo/
  app.js
  index.html
  styles.css
  analysis/
    objectDetector.js
    objectTracker.js
    objectLocalCv.js
    sceneSignals.js
    foregroundBackground.js
  render/
    actionRenderer.js
    neutralPreview.js
    actions/
      aura.js
      localEdges.js
      localLines.js
      foregroundBackground.js
      spotlight.js
      trail.js
      glitch.js
  llm/
    actionPlanSchema.js
    validateActionPlan.js
    defaultPlans.js
  server/
    planRoute.js
```

For the current lightweight demo, this can start without a full framework. The main architectural rule is to separate:

- detection/tracking
- object-local geometry
- action planning
- rendering

## 12. MVP Cut

The smallest compelling version:

- Object detection only
- Neutral preview
- Local edges inside object boxes
- Aura action
- Glitch action
- Prompt-to-action-plan endpoint
- Click-to-select object

This MVP is enough to demonstrate the original Latent Canvas thesis: the human points the system at meaning, object detection gives it structure, local CV extracts geometry, and the LLM directs the feeling.
