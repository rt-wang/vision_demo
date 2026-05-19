/*
 * Shader-generation prompt template + user-message builder (Phase 5).
 *
 * Used by the server. Frontend only sends the scene context payload; the
 * server attaches this system + user prompt and calls the model. Kept here so
 * the prompt lives next to the schema it must match (validateShaderPlan).
 */

export const SYSTEM_PROMPT = `You are the shader author for Mirage, a live computer-vision visual instrument.

Return only valid JSON in this exact shape:
{
  "title": string (<= 48 chars),
  "description": string (<= 160 chars),
  "fragmentShader": string (GLSL ES 1.00 fragment shader source),
  "uniforms": optional object of numeric default values
}

Hard rules:
- Generate only GLSL ES 1.00 fragment shader source for WebGL 1.
- Do not include JavaScript, HTML, CSS, markdown, comments outside GLSL, or any explanation.
- Use only the provided uniforms; do not declare new uniforms or attributes.
- Include "precision mediump float;".
- Include "varying vec2 v_uv;" (matches the host vertex shader).
- Include a "void main()" function that writes gl_FragColor.
- Use texture2D(), not the newer texture() function.
- Do not use #extension directives.
- Keep loops small with constant bounds (<= 16 iterations).
- Always sample u_video at least once.
- Use u_fgMask when the prompt mentions foreground, body, person, silhouette, motion, ghost, thermal, infrared, or background separation.
- Use u_edgeMask when the prompt mentions edge, outline, contour, scan, sketch, glow, electric, wireframe, or drawing.
- Prefer combining u_fgMask and u_edgeMask: Phase 5 is explicitly about OpenCV-guided shaders.
- Multiply mask samples by u_hasFgMask / u_hasEdgeMask so the shader degrades gracefully if a mask isn't ready.
- Multiply effect strength by u_intensity where it makes sense.`;

const CONTRACT_DESCRIPTION = `Required GLSL header (the host owns vertex shader + uniform binding):

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

Sampling notes:
- Each mask texture is a grayscale-encoded RGBA canvas: the mask value is in
  R, G, and B (alpha is always 1.0). Sample with texture2D(u_fgMask, v_uv).r
  and texture2D(u_edgeMask, v_uv).r — values are in [0,1].
- u_video is the live camera/video frame as RGBA in display space.
- v_uv is in [0,1] with origin at the top-left.
- u_hasFgMask / u_hasEdgeMask are 1.0 when the mask is current and 0.0 otherwise.

Minimum starter body that satisfies the contract:

void main() {
  vec4 video = texture2D(u_video, v_uv);
  float fg = texture2D(u_fgMask, v_uv).r * u_hasFgMask;
  float edge = texture2D(u_edgeMask, v_uv).r * u_hasEdgeMask;
  gl_FragColor = vec4(video.rgb, 1.0);
}

Example response (the actual GLSL string should be escaped JSON):
{
  "title": "Thermal Edge Ghost",
  "description": "Foreground glows hot, OpenCV edges shimmer green.",
  "fragmentShader": "precision mediump float; uniform sampler2D u_video; ...",
  "uniforms": {}
}`;

export function buildUserMessage(payload) {
  const ctx = {
    userPrompt:
      typeof payload?.userPrompt === "string" ? payload.userPrompt.slice(0, 500) : "",
    detectedClasses: Array.isArray(payload?.detectedClasses) ? payload.detectedClasses : [],
    signals: payload?.signals || {},
    masksAvailable: {
      foreground: !!payload?.masksAvailable?.foreground,
      edge: !!payload?.masksAvailable?.edge,
    },
    currentShaderTitle: payload?.currentShader?.title || null,
  };
  return `${CONTRACT_DESCRIPTION}

Scene context for this request:
${JSON.stringify(ctx, null, 2)}

User prompt: ${JSON.stringify(ctx.userPrompt)}

Respond with only the JSON ShaderPlan.`;
}
