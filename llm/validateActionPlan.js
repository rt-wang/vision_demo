/*
 * ActionPlan validator + sanitizer.
 *
 * The renderer must only ever receive a validated plan. This module is the
 * one place that:
 *   - parses LLM text into JSON (tolerating ```json fences / surrounding prose)
 *   - drops unknown actions / blend modes / label modes
 *   - clamps every numeric to [0,1] and every color channel to [0,255]
 *   - fills missing fields from per-action defaults
 *   - filters selector classes to currently-detected + known COCO classes
 *   - caps rule / action / label counts so a runaway plan can't tank the renderer
 *
 * Returns { ok, plan, errors }. The plan is always safe to render even when
 * ok=false; callers can use ok to decide whether to keep the previous plan.
 */

import {
  SUPPORTED_ACTIONS,
  SUPPORTED_LABEL_MODES,
  SUPPORTED_DEPTH_PALETTES,
  clamp01,
  clampColor,
  defaultGlobalStyle,
  blendMode,
} from "./actionPlanSchema.js";

export const MAX_RULES = 6;
export const MAX_ACTIONS_PER_RULE = 4;
export const MAX_LABEL_LEN = 32;
export const MAX_TITLE_LEN = 48;
export const MAX_PLAN_BYTES = 12 * 1024;

// COCO-SSD's 80 classes. Used to filter selector.classes when those classes
// aren't currently detected but are still a valid future target.
export const KNOWN_COCO_CLASSES = new Set([
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
  "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
  "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe",
  "backpack", "umbrella", "handbag", "tie", "suitcase",
  "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat",
  "baseball glove", "skateboard", "surfboard", "tennis racket",
  "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl",
  "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog",
  "pizza", "donut", "cake",
  "chair", "couch", "potted plant", "bed", "dining table", "toilet",
  "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
  "microwave", "oven", "toaster", "sink", "refrigerator",
  "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
]);

const ACTION_DEFAULTS = {
  localEdges: { opacity: 0.7, glow: 0.35, color: [126, 240, 197], thickness: 0.25 },
  localLines: { opacity: 0.7, color: [185, 225, 255], thickness: 0.25, jitter: 0.05 },
  localDepth: {
    opacity: 0.7,
    palette: "inferno",
    invert: 0,
    relief: 0.4,
    glow: 0.3,
    // 0 = colormap the whole bbox, 1 = clip to scene-level MOG2 foreground
    // mask so only moving silhouette pixels inside the bbox get color.
    onlyForeground: 0,
  },
  foregroundBackground: {
    opacity: 0.65,
    foregroundColor: [126, 240, 197],
    backgroundOpacity: 0.35,
    backgroundColor: [8, 12, 18],
    learningRate: 0.04,
    glow: 0.25,
  },
  freezeBox: {
    opacity: 0.78,
    decay: 0.06,
    jitter: 0.0,
    reframe: 0.0,
    blendMode: "normal",
  },
  aura:       { opacity: 0.5, color: [235, 210, 130], radius: 0.35, pulse: 0.2 },
  trail:      { opacity: 0.45, length: 0.45, smear: 0.18 },
  spotlight:  { opacity: 0.5, backgroundDim: 0.3, feather: 0.5 },
  glitch:     { opacity: 0.55, sliceAmount: 0.4, displacement: 0.25 },
};

// Enum fields per action — sanitizeAction picks these up and falls back to
// each action's default when the LLM returns an unsupported value.
const ACTION_ENUM_FIELDS = {
  localDepth: { palette: SUPPORTED_DEPTH_PALETTES },
};

function stripCodeFences(s) {
  return s
    .replace(/^\s*```(?:json|JSON)?\s*\n?/, "")
    .replace(/\n?\s*```\s*$/, "")
    .trim();
}

function tryParseJson(input) {
  if (typeof input !== "string") return input;
  const stripped = stripCodeFences(input);
  try {
    return JSON.parse(stripped);
  } catch (_) {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch (_) {
        /* fall through */
      }
    }
    return undefined;
  }
}

function sanitizeString(s, maxLen) {
  if (typeof s !== "string") return undefined;
  // Strip control characters (0x00-0x1F) without a literal regex range — some
  // serialization paths mangle in-source control bytes.
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 31) out += s[i];
  }
  out = out.trim();
  if (out.length === 0) return undefined;
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function sanitizeGlobalStyle(input) {
  const def = defaultGlobalStyle();
  if (!input || typeof input !== "object") return def;
  return {
    sourceOpacity: clamp01(input.sourceOpacity ?? def.sourceOpacity),
    tint: clampColor(input.tint || def.tint),
    contrast: clamp01(input.contrast ?? def.contrast),
    saturation: clamp01(input.saturation ?? def.saturation),
    grain: clamp01(input.grain ?? def.grain),
    trailLength: clamp01(input.trailLength ?? def.trailLength),
    blendMode: blendMode(input.blendMode || def.blendMode),
  };
}

function sanitizeAction(input) {
  if (!input || typeof input !== "object") return null;
  const type = input.type;
  if (!SUPPORTED_ACTIONS.includes(type)) return null;
  const def = ACTION_DEFAULTS[type];
  if (!def) return null;
  const enums = ACTION_ENUM_FIELDS[type] || {};
  const out = { type };
  for (const [k, v] of Object.entries(def)) {
    const inVal = input[k];
    if (enums[k]) {
      out[k] = typeof inVal === "string" && enums[k].includes(inVal) ? inVal : v;
    } else if (Array.isArray(v)) {
      out[k] = clampColor(Array.isArray(inVal) ? inVal : v);
    } else if (typeof v === "string") {
      // Non-enum string field — only `blendMode` lives here today, but treat
      // it generally so future per-action string fields don't silently leak
      // through.
      if (k === "blendMode") out[k] = blendMode(inVal || v);
      else out[k] = typeof inVal === "string" ? inVal : v;
    } else {
      out[k] = clamp01(inVal ?? v);
    }
  }
  return out;
}

function sanitizeLabel(input) {
  if (!input || typeof input !== "object") return null;
  const mode = SUPPORTED_LABEL_MODES.includes(input.mode) ? input.mode : null;
  if (!mode) return null;
  const out = { mode };
  if (mode === "poetic") {
    const text = sanitizeString(input.text, MAX_LABEL_LEN);
    if (text) out.text = text;
  }
  return out;
}

function sanitizeSelector(input, knownClasses) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  if (Array.isArray(input.classes)) {
    const filtered = input.classes
      .filter((c) => typeof c === "string")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => knownClasses.has(c));
    if (filtered.length > 0) out.classes = [...new Set(filtered)];
  }
  if (input.selectedOnly === true) out.selectedOnly = true;
  if (typeof input.minScore === "number") out.minScore = clamp01(input.minScore);
  if (input.largestOnly === true) out.largestOnly = true;
  return out;
}

function sanitizeRule(input, knownClasses, errors) {
  if (!input || typeof input !== "object") {
    errors.push("rule_not_object");
    return null;
  }
  const selector = sanitizeSelector(input.selector, knownClasses);
  const actionsIn = Array.isArray(input.actions) ? input.actions : [];
  const actions = [];
  for (const a of actionsIn) {
    const sa = sanitizeAction(a);
    if (sa) actions.push(sa);
    else errors.push(`unknown_action:${a && a.type}`);
    if (actions.length >= MAX_ACTIONS_PER_RULE) break;
  }
  if (actions.length === 0) {
    errors.push("rule_has_no_valid_actions");
    return null;
  }
  const out = { selector, actions };
  const label = sanitizeLabel(input.label);
  if (label) out.label = label;
  return out;
}

export function validateActionPlan(input, options = {}) {
  const errors = [];

  if (typeof input === "string" && input.length > MAX_PLAN_BYTES * 4) {
    return { ok: false, plan: null, errors: ["plan_too_large"] };
  }

  const parsed = tryParseJson(input);
  if (parsed === undefined) {
    return { ok: false, plan: null, errors: ["invalid_json"] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, plan: null, errors: ["not_object"] };
  }

  const knownClasses = new Set(KNOWN_COCO_CLASSES);
  if (Array.isArray(options.detectedClasses)) {
    for (const c of options.detectedClasses) {
      if (typeof c === "string") knownClasses.add(c.trim().toLowerCase());
    }
  }

  const title = sanitizeString(parsed.title, MAX_TITLE_LEN) || "Untitled Plan";
  const globalStyle = sanitizeGlobalStyle(parsed.globalStyle);

  const rulesIn = Array.isArray(parsed.objectRules) ? parsed.objectRules : [];
  const objectRules = [];
  for (const r of rulesIn) {
    const sr = sanitizeRule(r, knownClasses, errors);
    if (sr) objectRules.push(sr);
    if (objectRules.length >= MAX_RULES) break;
  }

  const ok = objectRules.length > 0;
  if (!ok) errors.push("no_valid_rules");

  return {
    ok,
    plan: { title, globalStyle, objectRules },
    errors,
  };
}
