/*
 * ShaderPlan validator + sanitizer (Phase 5).
 *
 * The compiler must only ever receive a sanitized shader. This module:
 *   - parses LLM text into JSON (tolerating ```json fences / surrounding prose)
 *   - strips markdown code fences from `fragmentShader`
 *   - enforces required GLSL contract: precision/main/u_video
 *   - rejects obvious non-GLSL content (script tags, fetch, eval, etc.)
 *   - clamps metadata strings + total size
 *   - returns { ok, shaderPlan, errors }
 *
 * On hard failure the caller should keep the previous working shader.
 */

export const MAX_TITLE_LEN = 48;
export const MAX_DESCRIPTION_LEN = 160;
export const MAX_FRAGMENT_BYTES = 16 * 1024;
export const MAX_PLAN_BYTES = 24 * 1024;

const FORBIDDEN_SUBSTRINGS = [
  "<script",
  "fetch(",
  "XMLHttpRequest",
  "import ",
  "document.",
  "window.",
  "eval(",
];

function stripCodeFences(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(/^\s*```(?:glsl|GLSL|json|JSON)?\s*\n?/, "")
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
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 31 || s.charCodeAt(i) === 10 || s.charCodeAt(i) === 9) {
      out += s[i];
    }
  }
  out = out.trim();
  if (out.length === 0) return undefined;
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function sanitizeUniforms(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const key of Object.keys(input)) {
    if (typeof key !== "string" || key.length > 32) continue;
    const v = input[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = Math.max(-1024, Math.min(1024, v));
    } else if (Array.isArray(v) && v.length <= 4 && v.every((x) => typeof x === "number" && Number.isFinite(x))) {
      out[key] = v.slice(0, 4).map((x) => Math.max(-1024, Math.min(1024, x)));
    }
  }
  return out;
}

export function validateShaderPlan(input) {
  const errors = [];

  if (typeof input === "string" && input.length > MAX_PLAN_BYTES * 4) {
    return { ok: false, shaderPlan: null, errors: ["plan_too_large"] };
  }

  const parsed = tryParseJson(input);
  if (parsed === undefined) {
    return { ok: false, shaderPlan: null, errors: ["invalid_json"] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, shaderPlan: null, errors: ["not_object"] };
  }

  let fragmentShader = parsed.fragmentShader;
  if (typeof fragmentShader !== "string") {
    return { ok: false, shaderPlan: null, errors: ["missing_fragment_shader"] };
  }
  fragmentShader = stripCodeFences(fragmentShader);

  if (fragmentShader.length === 0) {
    return { ok: false, shaderPlan: null, errors: ["empty_fragment_shader"] };
  }
  if (fragmentShader.length > MAX_FRAGMENT_BYTES) {
    return { ok: false, shaderPlan: null, errors: ["fragment_shader_too_large"] };
  }

  for (const bad of FORBIDDEN_SUBSTRINGS) {
    if (fragmentShader.includes(bad)) {
      return { ok: false, shaderPlan: null, errors: [`forbidden_substring:${bad}`] };
    }
  }

  // Required GLSL contract.
  if (!/precision\s+(?:lowp|mediump|highp)\s+float/.test(fragmentShader)) {
    return { ok: false, shaderPlan: null, errors: ["missing_precision"] };
  }
  if (!/void\s+main\s*\(/.test(fragmentShader)) {
    return { ok: false, shaderPlan: null, errors: ["missing_void_main"] };
  }
  if (!fragmentShader.includes("u_video")) {
    return { ok: false, shaderPlan: null, errors: ["missing_u_video"] };
  }
  // Reject if it looks like the shader doesn't sample u_video at all (string
  // is referenced only by uniform declaration line).
  if (!/texture2D\s*\(\s*u_video/.test(fragmentShader)) {
    errors.push("warn_no_u_video_sample");
  }
  const hasFg = fragmentShader.includes("u_fgMask");
  const hasEdge = fragmentShader.includes("u_edgeMask");
  if (!hasFg && !hasEdge) {
    errors.push("warn_no_opencv_mask_input");
  }

  const title = sanitizeString(parsed.title, MAX_TITLE_LEN) || "Untitled Shader";
  const description = sanitizeString(parsed.description, MAX_DESCRIPTION_LEN) || "";
  const uniforms = sanitizeUniforms(parsed.uniforms);

  const shaderPlan = {
    title,
    description,
    fragmentShader,
    uniforms,
  };

  return { ok: true, shaderPlan, errors };
}
