/*
 * Bridges CPU/canvas/OpenCV outputs into WebGL textures for the Phase 5
 * shader renderer.
 *
 * Each slot tracks a single GL texture sized to its current source canvas.
 * On every frame uploadTexture(gl, slot, canvas) calls texImage2D(canvas) so
 * the shader sees the latest pixels. Canvas-sourced uploads are NPOT-safe by
 * design: we configure each texture with CLAMP_TO_EDGE + LINEAR/NEAREST and
 * skip mipmaps.
 */

function createTexture(gl, { filter = gl.LINEAR } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

export function createTextureSlots(gl) {
  return {
    video: { texture: createTexture(gl, { filter: gl.LINEAR }), uploaded: false },
    fgMask: { texture: createTexture(gl, { filter: gl.LINEAR }), uploaded: false },
    edgeMask: { texture: createTexture(gl, { filter: gl.LINEAR }), uploaded: false },
  };
}

export function disposeTextureSlots(gl, slots) {
  if (!slots) return;
  for (const key of Object.keys(slots)) {
    const slot = slots[key];
    if (slot && slot.texture) {
      try { gl.deleteTexture(slot.texture); } catch (_) { /* ignore */ }
    }
  }
}

// 1x1 transparent black fallback so a uniform sampler is always valid even
// before its mask is computed.
function uploadEmpty(gl) {
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1, 1, 0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]),
  );
}

export function uploadCanvasTexture(gl, slot, canvas) {
  gl.bindTexture(gl.TEXTURE_2D, slot.texture);
  // First-pixel-row-on-top — matches our captureCanvas orientation and OpenCV
  // mask canvases. The vertex shader emits v_uv with origin top-left to match.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  if (!canvas || canvas.width === 0 || canvas.height === 0) {
    uploadEmpty(gl);
    slot.uploaded = false;
    return;
  }
  try {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      canvas,
    );
    slot.uploaded = true;
  } catch (err) {
    uploadEmpty(gl);
    slot.uploaded = false;
    console.warn("[shaderTextures] upload failed:", err);
  }
}

export function uploadEmptyTexture(gl, slot) {
  gl.bindTexture(gl.TEXTURE_2D, slot.texture);
  uploadEmpty(gl);
  slot.uploaded = false;
}
