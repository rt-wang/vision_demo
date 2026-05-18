/*
 * Phase 5 WebGL shader renderer.
 *
 * Owns:
 *   - a hidden offscreen canvas + WebGL1 context
 *   - the fixed full-screen-quad vertex shader
 *   - compile + link of the user/LLM fragment shader
 *   - per-frame uniform upload + draw
 *   - three texture slots (u_video, u_fgMask, u_edgeMask)
 *
 * Keeps the last successfully linked program (`lastGoodProgram`) so a failed
 * compile keeps rendering instead of going black. compileShader() returns a
 * structured result so the UI can show the GLSL compiler log inline.
 */

import {
  createTextureSlots,
  disposeTextureSlots,
  uploadCanvasTexture,
  uploadEmptyTexture,
} from "./shaderTextures.js";

const VERTEX_SHADER = `attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  // a_position is in [-1,1]; v_uv is in [0,1] with origin at top-left so the
  // canvas-sourced textures (captureCanvas, fgMask, edgeMask) render upright.
  v_uv = vec2((a_position.x + 1.0) * 0.5, 1.0 - (a_position.y + 1.0) * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

function compileSource(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!ok) {
    const log = gl.getShaderInfoLog(shader) || "shader_compile_failed";
    gl.deleteShader(shader);
    return { ok: false, shader: null, log };
  }
  return { ok: true, shader, log: "" };
}

function linkProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  const ok = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!ok) {
    const log = gl.getProgramInfoLog(program) || "program_link_failed";
    gl.deleteProgram(program);
    return { ok: false, program: null, log };
  }
  return { ok: true, program, log: "" };
}

export function createShaderRenderer({ width = 1280, height = 720 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const gl =
    canvas.getContext("webgl", { premultipliedAlpha: false, antialias: false }) ||
    canvas.getContext("experimental-webgl", { premultipliedAlpha: false, antialias: false });
  if (!gl) {
    throw new Error("webgl_unavailable");
  }

  // Compile the immutable vertex shader once.
  const vs = compileSource(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  if (!vs.ok) throw new Error(`vertex_shader_failed: ${vs.log}`);

  // Full-screen quad as two triangles.
  const quad = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
    -1,  1,
     1, -1,
     1,  1,
  ]);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const slots = createTextureSlots(gl);

  const state = {
    currentProgram: null,
    currentSource: null,
    lastGoodProgram: null,
    lastGoodSource: null,
    lastCompiledAt: 0,
    lastCompileLog: "",
    lastCompileOk: false,
    uniforms: {},
    attribs: {},
  };

  function resize(w, h) {
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
  }

  function cacheUniforms(program) {
    const uniformNames = [
      "u_video",
      "u_fgMask",
      "u_edgeMask",
      "u_resolution",
      "u_time",
      "u_intensity",
      "u_hasFgMask",
      "u_hasEdgeMask",
    ];
    const locations = {};
    for (const name of uniformNames) {
      locations[name] = gl.getUniformLocation(program, name);
    }
    return locations;
  }

  function cacheAttribs(program) {
    return {
      a_position: gl.getAttribLocation(program, "a_position"),
    };
  }

  function disposeProgram(program) {
    if (!program) return;
    try { gl.deleteProgram(program); } catch (_) { /* ignore */ }
  }

  // Compiles + links a fragment shader. On success the new program becomes the
  // active one AND is cached as lastGoodProgram. On failure the previous
  // working program is left intact and the compiler log is returned.
  function compileShader(fragmentSource) {
    const now = performance.now();
    const fs = compileSource(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!fs.ok) {
      state.lastCompiledAt = now;
      state.lastCompileLog = fs.log;
      state.lastCompileOk = false;
      return { ok: false, log: fs.log };
    }
    const link = linkProgram(gl, vs.shader, fs.shader);
    // Fragment shader object can be detached once linked.
    try { gl.deleteShader(fs.shader); } catch (_) { /* ignore */ }
    if (!link.ok) {
      state.lastCompiledAt = now;
      state.lastCompileLog = link.log;
      state.lastCompileOk = false;
      return { ok: false, log: link.log };
    }
    // Swap in the new program. Free the previous current program unless it is
    // still serving as lastGoodProgram (it always is at this point, because
    // we promote the new program to lastGoodProgram below — see disposal).
    if (state.currentProgram && state.currentProgram !== state.lastGoodProgram) {
      disposeProgram(state.currentProgram);
    }
    const oldGood = state.lastGoodProgram;
    state.currentProgram = link.program;
    state.currentSource = fragmentSource;
    state.lastGoodProgram = link.program;
    state.lastGoodSource = fragmentSource;
    state.uniforms = cacheUniforms(link.program);
    state.attribs = cacheAttribs(link.program);
    state.lastCompiledAt = now;
    state.lastCompileLog = "";
    state.lastCompileOk = true;
    if (oldGood && oldGood !== link.program) {
      disposeProgram(oldGood);
    }
    return { ok: true, log: "" };
  }

  // Per-frame draw. Texture canvases may be null if a mask isn't ready yet —
  // we upload a 1x1 transparent pixel in that case and signal !u_hasXMask.
  function renderShaderFrame(opts) {
    const program = state.currentProgram || state.lastGoodProgram;
    if (!program) return false;

    const { captureCanvas, foregroundMaskCanvas, edgeMaskCanvas } = opts;
    const width = captureCanvas?.width || canvas.width;
    const height = captureCanvas?.height || canvas.height;
    resize(width, height);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);

    // Textures.
    if (captureCanvas) {
      gl.activeTexture(gl.TEXTURE0);
      uploadCanvasTexture(gl, slots.video, captureCanvas);
      gl.uniform1i(state.uniforms.u_video, 0);
    } else {
      gl.activeTexture(gl.TEXTURE0);
      uploadEmptyTexture(gl, slots.video);
      gl.uniform1i(state.uniforms.u_video, 0);
    }

    gl.activeTexture(gl.TEXTURE1);
    if (foregroundMaskCanvas) {
      uploadCanvasTexture(gl, slots.fgMask, foregroundMaskCanvas);
    } else {
      uploadEmptyTexture(gl, slots.fgMask);
    }
    gl.uniform1i(state.uniforms.u_fgMask, 1);
    gl.uniform1f(state.uniforms.u_hasFgMask, foregroundMaskCanvas && slots.fgMask.uploaded ? 1.0 : 0.0);

    gl.activeTexture(gl.TEXTURE2);
    if (edgeMaskCanvas) {
      uploadCanvasTexture(gl, slots.edgeMask, edgeMaskCanvas);
    } else {
      uploadEmptyTexture(gl, slots.edgeMask);
    }
    gl.uniform1i(state.uniforms.u_edgeMask, 2);
    gl.uniform1f(state.uniforms.u_hasEdgeMask, edgeMaskCanvas && slots.edgeMask.uploaded ? 1.0 : 0.0);

    // Scalar uniforms.
    gl.uniform2f(state.uniforms.u_resolution, width, height);
    gl.uniform1f(state.uniforms.u_time, (opts.timeMs || 0) * 0.001);
    gl.uniform1f(state.uniforms.u_intensity, Number.isFinite(opts.intensity) ? opts.intensity : 1.0);

    // Vertex attribs.
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const aPos = state.attribs.a_position;
    if (aPos >= 0) {
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }

  function dispose() {
    disposeProgram(state.currentProgram);
    if (state.lastGoodProgram !== state.currentProgram) {
      disposeProgram(state.lastGoodProgram);
    }
    state.currentProgram = null;
    state.lastGoodProgram = null;
    disposeTextureSlots(gl, slots);
    try { gl.deleteBuffer(buffer); } catch (_) { /* ignore */ }
    try { gl.deleteShader(vs.shader); } catch (_) { /* ignore */ }
  }

  return {
    canvas,
    gl,
    compileShader,
    renderShaderFrame,
    resize,
    dispose,
    getState() {
      return {
        hasCurrent: !!state.currentProgram,
        currentSource: state.currentSource,
        lastGoodSource: state.lastGoodSource,
        lastCompiledAt: state.lastCompiledAt,
        lastCompileOk: state.lastCompileOk,
        lastCompileLog: state.lastCompileLog,
      };
    },
  };
}
