/*
 * Planner prompt template + user-message builder.
 *
 * Used by the Node reference server. Kept in /llm so the prompt lives next to
 * the schema it must match. The browser never imports this — it only sends
 * the context payload; the server attaches this system + user prompt.
 */

import {
  SUPPORTED_ACTIONS,
  SUPPORTED_BLEND_MODES,
  SUPPORTED_LABEL_MODES,
  SUPPORTED_DEPTH_PALETTES,
} from "./actionPlanSchema.js";

export const SYSTEM_PROMPT = `You are the action planner for Mirage, a live object-aware visual instrument.

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
Avoid making every action maximum intensity.`;

const SCHEMA_DESCRIPTION = `ActionPlan schema:

{
  "title": string (<= 48 chars, short evocative phrase),
  "globalStyle": {
    "sourceOpacity": 0..1,
    "tint": [r, g, b] (each 0..255),
    "contrast": 0..1   (0.5 = neutral),
    "saturation": 0..1 (0.5 = neutral),
    "grain": 0..1,
    "trailLength": 0..1,
    "blendMode": one of ${JSON.stringify(SUPPORTED_BLEND_MODES)}
  },
  "objectRules": [
    {
      "selector": {
        "classes"?: string[]      // COCO class names; omit for a fallback rule
        "selectedOnly"?: boolean,
        "minScore"?: 0..1,
        "largestOnly"?: boolean
      },
      "label"?: {
        "mode": one of ${JSON.stringify(SUPPORTED_LABEL_MODES)},
        "text"?: string (<= 32 chars, only for "poetic")
      },
      "actions": CreativeAction[]
    }
  ]
}

CreativeAction is one of:
  { "type": "localEdges", "opacity": 0..1, "glow": 0..1, "color": [r,g,b], "thickness": 0..1 }
  { "type": "localLines", "opacity": 0..1, "color": [r,g,b], "thickness": 0..1, "jitter": 0..1 }
  { "type": "localDepth", "opacity": 0..1, "palette": one of ${JSON.stringify(SUPPORTED_DEPTH_PALETTES)}, "invert": 0..1, "relief": 0..1, "glow": 0..1, "onlyForeground": 0..1 }
  { "type": "foregroundBackground", "opacity": 0..1, "foregroundColor": [r,g,b], "backgroundOpacity": 0..1, "backgroundColor": [r,g,b], "learningRate": 0..1, "glow": 0..1 }
  { "type": "freezeBox",  "opacity": 0..1, "decay": 0..1, "jitter": 0..1, "reframe": 0..1, "blendMode": one of ${JSON.stringify(SUPPORTED_BLEND_MODES)} }
  { "type": "aura",       "opacity": 0..1, "color": [r,g,b], "radius": 0..1,    "pulse": 0..1 }
  { "type": "trail",      "opacity": 0..1, "length": 0..1,   "smear": 0..1 }
  { "type": "spotlight",  "opacity": 0..1, "backgroundDim": 0..1, "feather": 0..1 }
  { "type": "glitch",     "opacity": 0..1, "sliceAmount": 0..1, "displacement": 0..1 }

Allowed action types: ${JSON.stringify(SUPPORTED_ACTIONS)}.

Notes:
- localDepth colormaps an object's interior using a hand-tuned palette. Use it
  for "material", "depth", "relic", "scan", "fossil" prompts. decay-style
  prompts about evolving textures should prefer trail or freezeBox.
- localDepth.onlyForeground=1 clips the colormap to the scene-level motion
  silhouette so only moving body pixels get color (thermal-imaging look). Use
  this for "thermal", "moving body", "silhouette", "infrared" prompts. The
  background of the bbox stays untouched.
- freezeBox pins an object's crop as a held memory tile. decay≈0 keeps the
  original frame forever; decay≈0.1 lets it evolve slowly. Use it for
  "frozen", "preserved", "memory", "captured", "pinned" prompts.

Example output:
{
  "title": "Soft Machine Weather",
  "globalStyle": { "sourceOpacity": 0.68, "tint": [140,190,255], "contrast": 0.54, "saturation": 0.42, "grain": 0.14, "trailLength": 0, "blendMode": "screen" },
  "objectRules": [
    { "selector": { "classes": ["person"], "minScore": 0.4 },
      "label": { "mode": "poetic", "text": "warm witness" },
      "actions": [
        { "type": "aura", "opacity": 0.68, "color": [255,205,145], "radius": 0.36, "pulse": 0.24 },
        { "type": "spotlight", "opacity": 0.44, "backgroundDim": 0.26, "feather": 0.58 }
      ]
    },
    { "selector": { "classes": ["laptop","cell phone","tv"], "minScore": 0.35 },
      "label": { "mode": "poetic", "text": "cold signal" },
      "actions": [
        { "type": "glitch", "opacity": 0.72, "sliceAmount": 0.56, "displacement": 0.34 },
        { "type": "localEdges", "opacity": 0.88, "glow": 0.62, "color": [90,255,185], "thickness": 0.36 }
      ]
    }
  ]
}`;

export function buildUserMessage(payload) {
  const ctx = {
    userPrompt: typeof payload?.userPrompt === "string" ? payload.userPrompt.slice(0, 500) : "",
    detectedClasses: Array.isArray(payload?.detectedClasses) ? payload.detectedClasses : [],
    signals: payload?.signals || {},
    currentPlanTitle: payload?.currentPlan?.title || null,
  };
  return `${SCHEMA_DESCRIPTION}

Context for this request:
${JSON.stringify(ctx, null, 2)}

User prompt: ${JSON.stringify(ctx.userPrompt)}

Respond with only the JSON ActionPlan.`;
}
