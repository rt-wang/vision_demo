/*
 * ActionPlan schema constants + clamp helpers.
 *
 * Phase 4 will add a full `validateActionPlan(input)` that runs raw LLM output
 * through this. For Phase 3 we only need the constants so renderers can
 * cross-check, and the clamp helpers so hardcoded presets can be authored
 * loosely and still land in valid ranges.
 */

export const SUPPORTED_ACTIONS = [
  "localEdges",
  "localLines",
  "localDepth",
  "foregroundBackground",
  "freezeBox",
  "aura",
  "trail",
  "spotlight",
  "glitch",
];

export const SUPPORTED_BLEND_MODES = [
  "normal",
  "screen",
  "multiply",
  "difference",
  "overlay",
];

export const SUPPORTED_LABEL_MODES = ["literal", "poetic", "hidden"];

export const SUPPORTED_DEPTH_PALETTES = ["inferno", "bone", "ocean", "magma"];

export const clamp01 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

export const clamp255 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
};

export const clampColor = (c) => {
  if (!Array.isArray(c) || c.length < 3) return [255, 255, 255];
  return [clamp255(c[0]), clamp255(c[1]), clamp255(c[2])];
};

export function defaultGlobalStyle() {
  return {
    sourceOpacity: 1.0,
    tint: [255, 255, 255],
    contrast: 0.5,
    saturation: 0.5,
    grain: 0,
    trailLength: 0,
    blendMode: "normal",
  };
}

export function blendMode(m) {
  return SUPPORTED_BLEND_MODES.includes(m) ? m : "normal";
}
