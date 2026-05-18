/*
 * Default + debug fragment shaders for the Phase 5 OpenCV-aware shader path.
 *
 * The app owns the vertex shader and uniform binding. The model (and the
 * editable shader textarea) only writes fragment shader source. Every shader
 * here uses the fixed Phase 5 uniform contract so it can be swapped in/out at
 * runtime without changing the renderer.
 */

export const SHADER_HEADER = `precision mediump float;

uniform sampler2D u_video;
uniform sampler2D u_fgMask;
uniform sampler2D u_edgeMask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_hasFgMask;
uniform float u_hasEdgeMask;

varying vec2 v_uv;
`;

export const DEFAULT_SHADER = `precision mediump float;

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
`;

export const PASSTHROUGH_SHADER = `precision mediump float;

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
  gl_FragColor = texture2D(u_video, v_uv);
}
`;

export const FOREGROUND_DEBUG_SHADER = `precision mediump float;

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
  float fg = texture2D(u_fgMask, v_uv).r * u_hasFgMask;
  gl_FragColor = vec4(vec3(fg), 1.0);
}
`;

export const EDGE_DEBUG_SHADER = `precision mediump float;

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
  float edge = texture2D(u_edgeMask, v_uv).r * u_hasEdgeMask;
  gl_FragColor = vec4(vec3(edge), 1.0);
}
`;

export const THERMAL_FOREGROUND_SHADER = `precision mediump float;

uniform sampler2D u_video;
uniform sampler2D u_fgMask;
uniform sampler2D u_edgeMask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_hasFgMask;
uniform float u_hasEdgeMask;

varying vec2 v_uv;

vec3 thermal(float t) {
  vec3 c0 = vec3(0.0, 0.0, 0.18);
  vec3 c1 = vec3(0.36, 0.0, 0.55);
  vec3 c2 = vec3(0.92, 0.18, 0.10);
  vec3 c3 = vec3(1.0, 0.78, 0.10);
  vec3 c4 = vec3(1.0, 1.0, 0.9);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.55) return mix(c1, c2, (t - 0.25) / 0.30);
  if (t < 0.85) return mix(c2, c3, (t - 0.55) / 0.30);
  return mix(c3, c4, (t - 0.85) / 0.15);
}

void main() {
  vec4 video = texture2D(u_video, v_uv);
  float fg = texture2D(u_fgMask, v_uv).r * u_hasFgMask;
  float lum = dot(video.rgb, vec3(0.299, 0.587, 0.114));
  vec3 hot = thermal(clamp(lum + 0.15 * sin(u_time + v_uv.y * 6.0), 0.0, 1.0));
  vec3 cold = video.rgb * 0.18;
  vec3 color = mix(cold, hot, fg * u_intensity);
  gl_FragColor = vec4(color, 1.0);
}
`;

export const EDGE_GLOW_SHADER = `precision mediump float;

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
  float edge = texture2D(u_edgeMask, v_uv).r * u_hasEdgeMask;

  vec2 px = 1.0 / u_resolution;
  float halo = 0.0;
  for (int i = -2; i <= 2; i++) {
    for (int j = -2; j <= 2; j++) {
      vec2 o = vec2(float(i), float(j)) * px * 2.0;
      halo += texture2D(u_edgeMask, v_uv + o).r;
    }
  }
  halo = halo / 25.0 * u_hasEdgeMask;

  vec3 base = video.rgb * 0.4;
  vec3 glow = vec3(0.2, 1.0, 0.6) * halo * 1.4 * u_intensity;
  vec3 sharp = vec3(0.6, 1.0, 0.85) * edge;
  gl_FragColor = vec4(base + glow + sharp, 1.0);
}
`;

export const DEFAULT_SHADER_PLAN = {
  title: "OpenCV Default",
  description: "Foreground gets warm thermal tint, OpenCV edges glow green.",
  fragmentShader: DEFAULT_SHADER,
  uniforms: {},
};
