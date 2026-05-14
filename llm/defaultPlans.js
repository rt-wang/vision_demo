/*
 * Hardcoded preset ActionPlans for Phase 3.
 *
 * These exist so the action vocabulary can be exercised without the LLM.
 * Each preset is intentionally different in feel so switching between them
 * makes it obvious that the system can produce meaningfully different looks
 * from the same detected objects.
 *
 * `neutral` has a null plan — the host falls back to neutralPreview for it.
 */

export const PRESETS = [
  {
    id: "neutral",
    title: "Neutral",
    plan: null,
  },
  {
    id: "cold-mirror",
    title: "Cold Mirror",
    plan: {
      title: "Cold Mirror",
      globalStyle: {
        sourceOpacity: 0.6,
        tint: [120, 160, 220],
        contrast: 0.72,
        saturation: 0.18,
        grain: 0.08,
        trailLength: 0.0,
        blendMode: "multiply",
      },
      objectRules: [
        {
          selector: {},
          label: { mode: "literal" },
          actions: [
            {
              type: "localLines",
              opacity: 0.9,
              color: [185, 225, 255],
              thickness: 0.28,
              jitter: 0.04,
            },
            {
              type: "localEdges",
              opacity: 0.55,
              glow: 0.35,
              color: [205, 235, 255],
              thickness: 0.2,
            },
          ],
        },
      ],
    },
  },
  {
    id: "thermal-relic",
    title: "Thermal Relic",
    plan: {
      title: "Thermal Relic",
      globalStyle: {
        sourceOpacity: 0.42,
        tint: [255, 180, 120],
        contrast: 0.66,
        saturation: 0.42,
        grain: 0.22,
        trailLength: 0,
        blendMode: "screen",
      },
      objectRules: [
        {
          selector: { classes: ["person"], minScore: 0.4 },
          label: { mode: "poetic", text: "thermal body" },
          actions: [
            {
              type: "localDepth",
              opacity: 0.85,
              palette: "inferno",
              invert: 0,
              relief: 0.5,
              glow: 0.35,
            },
            {
              type: "localEdges",
              opacity: 0.55,
              glow: 0.42,
              color: [255, 200, 120],
              thickness: 0.24,
            },
          ],
        },
        {
          selector: {
            classes: ["laptop", "cell phone", "tv", "keyboard", "remote", "mouse", "book", "cup", "bottle"],
            minScore: 0.35,
          },
          label: { mode: "poetic", text: "artifact" },
          actions: [
            {
              type: "freezeBox",
              opacity: 0.72,
              decay: 0.03,
              jitter: 0.04,
              reframe: 0.0,
              blendMode: "screen",
            },
            {
              type: "localDepth",
              opacity: 0.6,
              palette: "bone",
              invert: 0,
              relief: 0.55,
              glow: 0.18,
            },
          ],
        },
      ],
    },
  },
  {
    id: "thermal-moving-body",
    title: "Thermal Moving Body",
    plan: {
      title: "Thermal Moving Body",
      globalStyle: {
        sourceOpacity: 0.32,
        tint: [40, 30, 60],
        contrast: 0.7,
        saturation: 0.35,
        grain: 0.12,
        trailLength: 0,
        blendMode: "multiply",
      },
      objectRules: [
        {
          selector: { classes: ["person"], minScore: 0.4 },
          label: { mode: "poetic", text: "heat" },
          actions: [
            {
              type: "localDepth",
              opacity: 0.98,
              palette: "inferno",
              invert: 0,
              relief: 0.55,
              glow: 0.5,
              onlyForeground: 1,
            },
          ],
        },
        {
          selector: {},
          label: { mode: "hidden" },
          actions: [
            {
              type: "foregroundBackground",
              opacity: 0.0,
              foregroundColor: [255, 255, 255],
              backgroundOpacity: 0.55,
              backgroundColor: [4, 4, 8],
              learningRate: 0.02,
              glow: 0,
            },
          ],
        },
      ],
    },
  },
  {
    id: "glitch-storm",
    title: "Glitch Storm",
    plan: {
      title: "Glitch Storm",
      globalStyle: {
        sourceOpacity: 0.85,
        tint: [255, 110, 200],
        contrast: 0.65,
        saturation: 0.85,
        grain: 0.32,
        trailLength: 0.45,
        blendMode: "difference",
      },
      objectRules: [
        {
          selector: {},
          label: { mode: "hidden" },
          actions: [
            { type: "trail", opacity: 0.65, length: 0.72, smear: 0.3 },
            { type: "glitch", opacity: 0.9, sliceAmount: 0.7, displacement: 0.55 },
            { type: "aura", opacity: 0.4, color: [255, 100, 200], radius: 0.32, pulse: 0.65 },
          ],
        },
      ],
    },
  },
];

export function findPreset(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}
