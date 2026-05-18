/*
 * Latent Canvas — Phase 5 shader-first.
 *
 * Pipeline:
 *   getUserMedia → hidden <video>
 *     → captureCanvas (mirrored at capture, display space)
 *       → COCO-SSD → tracker → DetectedObject[]    (scene structure)
 *       → MOG2 foreground mask canvas              (u_fgMask)
 *       → scene-level Canny edge mask canvas       (u_edgeMask)
 *       → WebGL fragment shader (AI-authored / editable / default)
 *         → shaderRenderer canvas
 *           → drawImage into output 2D canvas
 *
 * The fragment shader is the entire renderer. Prompts go to /api/shader and
 * return a complete GLSL ES 1.00 fragment shader, which the browser compiles.
 * Compile errors stay visible in the editor; the last working shader keeps
 * rendering on failure (lastGoodProgram inside shaderRenderer).
 */

import { loadDetector, detect } from "./analysis/objectDetector.js";
import { createTracker } from "./analysis/objectTracker.js";
import {
  computeForegroundBackground,
  isReady as isForegroundBackgroundReady,
  resetForegroundBackgroundModel,
  getForegroundMaskCanvas,
} from "./analysis/foregroundBackground.js";
import {
  computeSceneEdgeMask,
  isReady as isSceneEdgeMaskReady,
  getSceneEdgeMaskCanvas,
} from "./analysis/sceneEdgeMask.js";
import { computeSceneSignals } from "./analysis/sceneSignals.js";
import { createShaderRenderer } from "./render/shader/shaderRenderer.js";
import {
  DEFAULT_SHADER,
  DEFAULT_SHADER_PLAN,
} from "./render/shader/defaultShaders.js";
import { requestShaderPlan } from "./llm/shaderClient.js";
import { validateShaderPlan } from "./llm/validateShaderPlan.js";

const video = document.getElementById("video");
const outputCanvas = document.getElementById("output");
const outputCtx = outputCanvas.getContext("2d");

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

const ui = {
  fps: document.getElementById("fps"),
  status: document.getElementById("status"),
  countBadge: document.getElementById("countBadge"),
  shaderTitle: document.getElementById("shaderTitle"),
  intensitySlider: document.getElementById("intensitySlider"),
  intensityValue: document.getElementById("intensityValue"),
  promptForm: document.getElementById("promptForm"),
  promptInput: document.getElementById("promptInput"),
  promptSubmit: document.getElementById("promptSubmit"),
  promptStatus: document.getElementById("promptStatus"),
  boot: document.getElementById("boot"),
  bootStep: document.getElementById("bootStep"),
  bootBar: document.getElementById("bootBar"),
  editorToggle: document.getElementById("editorToggle"),
  editor: document.getElementById("editor"),
  editorClose: document.getElementById("editorClose"),
  editorRender: document.getElementById("editorRender"),
  editorReset: document.getElementById("editorReset"),
  editorCopy: document.getElementById("editorCopy"),
  editorSource: document.getElementById("editorSource"),
  editorMeta: document.getElementById("editorMeta"),
  editorStatus: document.getElementById("editorStatus"),
  editorCode: document.getElementById("editorCode"),
  editorError: document.getElementById("editorError"),
  feedToggle: document.getElementById("feedToggle"),
  sourceToggle: document.getElementById("sourceToggle"),
  sourceFile: document.getElementById("sourceFile"),
  viewToggle: document.getElementById("viewToggle"),
};

// Debug view cycles through: shader output, video only, fg mask canvas, edge mask canvas.
const VIEWS = ["shader", "video", "fg", "edge"];
const VIEW_LABELS = { shader: "SHADER", video: "VIDEO", fg: "FG MASK", edge: "EDGE MASK" };

const state = {
  detector: null,
  tracker: createTracker(),
  objects: [],
  sceneSignals: null,
  foregroundBackground: null,
  sceneEdgeMask: null,

  // Active shader.
  shader: {
    title: DEFAULT_SHADER_PLAN.title,
    description: DEFAULT_SHADER_PLAN.description,
    source: "default", // "default" | "llm" | "edit" | "fallback"
    fragmentShader: DEFAULT_SHADER,
    compileStatus: "idle", // "idle" | "ok" | "error"
    compileError: null,
    lastCompiledAt: 0,
  },

  // Prompt flow.
  promptPending: false,
  lastShaderWarnings: [],
  editorOpen: false,
  hideFeed: false,
  view: "shader",

  // Video source. "camera" uses getUserMedia (mirrored); "file" loops a user-
  // supplied video via object URL (not mirrored).
  videoSource: "camera",
  cameraStream: null,
  videoFileUrl: null,

  // Intensity smoothing.
  targetIntensity: 0.8,
  currentIntensity: 0.8,
  shaderSwitchAt: 0,

  fpsAcc: { last: performance.now(), frames: 0 },
};

const INTENSITY_SMOOTHING = 0.12;
const SHADER_DUCK_MS = 220;

const shaderRenderer = createShaderRenderer({ width: 1280, height: 720 });

function setStatus(text, ready = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("is-ready", ready);
}

function setBootStep(text, pct) {
  ui.bootStep.textContent = text;
  if (typeof pct === "number") ui.bootBar.style.width = `${pct}%`;
}

function hideBoot() {
  ui.boot.classList.add("is-hidden");
}

function setPromptStatus(text, kind) {
  ui.promptStatus.textContent = text || "";
  ui.promptStatus.classList.remove("is-ok", "is-mock", "is-err");
  if (kind) ui.promptStatus.classList.add(`is-${kind}`);
}

async function setupCamera() {
  setBootStep("requesting camera…", 10);
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
  state.cameraStream = stream;
  state.videoSource = "camera";
  video.loop = false;
  video.src = "";
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play();
  sizeCanvases();
  setBootStep("camera ready", 40);
}

function stopCameraStream() {
  if (!state.cameraStream) return;
  for (const track of state.cameraStream.getTracks()) {
    try { track.stop(); } catch (_) { /* ignore */ }
  }
  state.cameraStream = null;
}

function revokeVideoFileUrl() {
  if (!state.videoFileUrl) return;
  try { URL.revokeObjectURL(state.videoFileUrl); } catch (_) { /* ignore */ }
  state.videoFileUrl = null;
}

async function useVideoFile(file) {
  stopCameraStream();
  revokeVideoFileUrl();

  const url = URL.createObjectURL(file);
  state.videoFileUrl = url;
  state.videoSource = "file";

  video.srcObject = null;
  video.loop = true;
  video.muted = true;
  video.src = url;

  await new Promise((resolve, reject) => {
    const onMeta = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error("video load failed")); };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onErr);
    };
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onErr);
  });
  await video.play();
  sizeCanvases();
  resetForegroundBackgroundModel();
  refreshSourceToggle();
}

async function useCamera() {
  revokeVideoFileUrl();
  video.loop = false;
  video.src = "";
  if (!state.cameraStream) {
    try {
      await setupCamera();
    } catch (err) {
      console.error("[useCamera] failed:", err);
      setPromptStatus("camera unavailable", "err");
      return;
    }
  } else {
    state.videoSource = "camera";
    video.srcObject = state.cameraStream;
    await video.play().catch(() => {});
    sizeCanvases();
  }
  resetForegroundBackgroundModel();
  refreshSourceToggle();
}

function refreshSourceToggle() {
  const isFile = state.videoSource === "file";
  ui.sourceToggle.classList.toggle("is-active", isFile);
  ui.sourceToggle.setAttribute("aria-pressed", isFile ? "true" : "false");
  ui.sourceToggle.textContent = isFile ? "CAM↺" : "VIDEO";
  ui.sourceToggle.title = isFile
    ? "Switch back to camera"
    : "Use a video file as the source";
}

function sizeCanvases() {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  outputCanvas.width = w;
  outputCanvas.height = h;
  captureCanvas.width = w;
  captureCanvas.height = h;
  shaderRenderer.resize(w, h);
}

function captureFrame() {
  const w = captureCanvas.width;
  const h = captureCanvas.height;
  captureCtx.save();
  if (state.videoSource === "camera") {
    captureCtx.setTransform(-1, 0, 0, 1, w, 0);
  } else {
    captureCtx.setTransform(1, 0, 0, 1, 0, 0);
  }
  captureCtx.drawImage(video, 0, 0, w, h);
  captureCtx.restore();
}

function updateCountBadge(objects) {
  const live = objects.filter((o) => !o.stale).length;
  ui.countBadge.textContent = `${live} ${live === 1 ? "object" : "objects"}`;
}

function tickFps(now) {
  state.fpsAcc.frames += 1;
  const elapsed = now - state.fpsAcc.last;
  if (elapsed >= 500) {
    const fps = (state.fpsAcc.frames * 1000) / elapsed;
    ui.fps.textContent = `${fps.toFixed(0)} fps`;
    state.fpsAcc.frames = 0;
    state.fpsAcc.last = now;
  }
}

function effectiveTargetIntensity(now) {
  const dt = now - state.shaderSwitchAt;
  if (dt < SHADER_DUCK_MS) return 0;
  return state.targetIntensity;
}

function updateIntensitySliderFill(value) {
  ui.intensitySlider.style.setProperty("--fill", `${value * 100}%`);
  ui.intensityValue.textContent = String(Math.round(value * 100));
}

function refreshShaderTitle() {
  ui.shaderTitle.textContent = state.shader.title || "Shader";
}

const EDITOR_SOURCE_LABEL = {
  default: "default",
  llm: "llm",
  edit: "edit",
  fallback: "fallback",
};

function refreshEditorMeta() {
  const source = state.shader.source;
  ui.editorSource.textContent = EDITOR_SOURCE_LABEL[source] || source;
  ui.editorSource.className = `editor__source is-${source}`;

  ui.editorMeta.replaceChildren();
  if (state.shader.description) {
    const span = document.createElement("span");
    span.textContent = state.shader.description;
    ui.editorMeta.appendChild(span);
  }
  if (state.lastShaderWarnings && state.lastShaderWarnings.length > 0) {
    if (ui.editorMeta.childNodes.length > 0) {
      ui.editorMeta.appendChild(document.createElement("br"));
    }
    const span = document.createElement("span");
    span.className = "warn";
    span.textContent = `warnings: ${state.lastShaderWarnings.join(", ")}`;
    ui.editorMeta.appendChild(span);
  }
  if (ui.editorMeta.childNodes.length === 0) {
    ui.editorMeta.textContent = "—";
  }
}

function refreshEditorStatus() {
  ui.editorStatus.classList.remove("is-ok", "is-err", "is-busy");
  if (state.shader.compileStatus === "ok") {
    ui.editorStatus.classList.add("is-ok");
    const when = state.shader.lastCompiledAt
      ? new Date(state.shader.lastCompiledAt).toLocaleTimeString()
      : "";
    ui.editorStatus.textContent = `compiled · ${when}`;
  } else if (state.shader.compileStatus === "error") {
    ui.editorStatus.classList.add("is-err");
    ui.editorStatus.textContent = "compile error · using last working shader";
  } else {
    ui.editorStatus.textContent = "idle";
  }
  ui.editorError.textContent = state.shader.compileError || "";
  ui.editorCode.classList.toggle("is-invalid", state.shader.compileStatus === "error");
}

function refreshEditorCode() {
  if (document.activeElement !== ui.editorCode) {
    ui.editorCode.value = state.shader.fragmentShader || "";
  }
}

function refreshEditor() {
  refreshEditorMeta();
  refreshEditorStatus();
  refreshEditorCode();
}

function announceShaderSwitch() {
  state.shaderSwitchAt = performance.now();
}

function applyShaderPlan(plan, source, warnings) {
  const fragmentSource = plan.fragmentShader;
  const result = shaderRenderer.compileShader(fragmentSource);
  if (!result.ok) {
    // Hard fail: keep previous shader running, just surface the error.
    state.shader.compileStatus = "error";
    state.shader.compileError = result.log;
    state.shader.lastCompiledAt = performance.now();
    state.lastShaderWarnings = warnings || [];
    refreshEditor();
    return false;
  }
  state.shader = {
    title: plan.title || "Shader",
    description: plan.description || "",
    source,
    fragmentShader: fragmentSource,
    compileStatus: "ok",
    compileError: null,
    lastCompiledAt: performance.now(),
  };
  state.lastShaderWarnings = warnings || [];
  announceShaderSwitch();
  refreshShaderTitle();
  refreshEditor();
  return true;
}

function applyDefaultShader() {
  const ok = applyShaderPlan(DEFAULT_SHADER_PLAN, "default", []);
  if (ok) {
    ui.editorCode.value = DEFAULT_SHADER;
  }
}

async function copyEditorCode() {
  const text = ui.editorCode.value || "";
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand("copy");
      document.body.removeChild(ta);
    }
  } catch (err) {
    console.warn("[editor] copy failed:", err);
  }
  const btn = ui.editorCopy;
  btn.textContent = copied ? "copied" : "failed";
  btn.classList.toggle("is-flash", copied);
  setTimeout(() => {
    btn.textContent = "copy";
    btn.classList.remove("is-flash");
  }, 1200);
}

function applyEditorEdit() {
  const text = ui.editorCode.value || "";
  const v = validateShaderPlan({
    title: state.shader.title,
    description: state.shader.description,
    fragmentShader: text,
  });
  if (!v.ok) {
    state.shader.compileStatus = "error";
    state.shader.compileError = `validation: ${v.errors.join(", ")}`;
    refreshEditor();
    return;
  }
  const ok = applyShaderPlan(
    { ...v.shaderPlan, title: state.shader.title || v.shaderPlan.title },
    "edit",
    v.errors,
  );
  if (ok) {
    const btn = ui.editorRender;
    btn.textContent = "rendered";
    btn.classList.add("is-flash");
    setTimeout(() => {
      btn.textContent = "Render";
      btn.classList.remove("is-flash");
    }, 1000);
  }
}

function setEditorOpen(open) {
  state.editorOpen = open;
  ui.editor.classList.toggle("is-open", open);
  ui.editor.setAttribute("aria-hidden", open ? "false" : "true");
  ui.editorToggle.classList.toggle("is-active", open);
  ui.editorToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) refreshEditor();
}

function setHideFeed(hide) {
  state.hideFeed = hide;
  ui.feedToggle.classList.toggle("is-active", hide);
  ui.feedToggle.setAttribute("aria-pressed", hide ? "true" : "false");
}

function setView(view) {
  if (!VIEWS.includes(view)) view = "shader";
  state.view = view;
  ui.viewToggle.textContent = VIEW_LABELS[view];
  ui.viewToggle.classList.toggle("is-active", view !== "shader");
}

function cycleView() {
  const idx = VIEWS.indexOf(state.view);
  const next = VIEWS[(idx + 1) % VIEWS.length];
  setView(next);
}

async function submitPrompt() {
  if (state.promptPending) return;
  const text = ui.promptInput.value.trim();
  if (!text) return;

  state.promptPending = true;
  ui.promptSubmit.disabled = true;
  setPromptStatus("generating…", null);

  const detectedClasses = state.sceneSignals?.classes || [];
  const payload = {
    userPrompt: text,
    detectedClasses,
    signals: state.sceneSignals || {},
    currentShader: state.shader
      ? { title: state.shader.title }
      : null,
    masksAvailable: {
      foreground: !!getForegroundMaskCanvas(),
      edge: !!getSceneEdgeMaskCanvas(),
    },
  };

  try {
    const { shaderPlan, warnings } = await requestShaderPlan(payload);
    const ok = applyShaderPlan(shaderPlan, "llm", warnings);
    if (ok) {
      setPromptStatus("applied", "ok");
    } else {
      setPromptStatus("compile error", "err");
    }
  } catch (err) {
    console.error("[shader] failed:", err);
    state.shader.compileError = err.message || String(err);
    setPromptStatus("invalid", "err");
    refreshEditor();
  } finally {
    state.promptPending = false;
    ui.promptSubmit.disabled = false;
  }
}

function wireUi() {
  refreshShaderTitle();
  setView("shader");

  const onSlider = () => {
    const v = Number(ui.intensitySlider.value) / 100;
    state.targetIntensity = v;
    updateIntensitySliderFill(v);
  };
  ui.intensitySlider.addEventListener("input", onSlider);
  onSlider();

  ui.promptForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitPrompt();
  });

  ui.editorToggle.addEventListener("click", () => setEditorOpen(!state.editorOpen));
  ui.editorClose.addEventListener("click", () => setEditorOpen(false));
  ui.editorRender.addEventListener("click", applyEditorEdit);
  ui.editorReset.addEventListener("click", () => {
    applyDefaultShader();
  });
  ui.editorCopy.addEventListener("click", copyEditorCode);
  ui.editorCode.addEventListener("input", () => {
    ui.editorCode.classList.remove("is-invalid");
  });
  ui.editorCode.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      applyEditorEdit();
    }
  });

  ui.feedToggle.addEventListener("click", () => setHideFeed(!state.hideFeed));
  ui.viewToggle.addEventListener("click", () => cycleView());

  ui.sourceToggle.addEventListener("click", () => {
    if (state.videoSource === "file") {
      useCamera();
    } else {
      ui.sourceFile.click();
    }
  });
  ui.sourceFile.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    useVideoFile(file).catch((err) => {
      console.error("[sourceFile] failed:", err);
      setPromptStatus("video load failed", "err");
    });
  });
  refreshSourceToggle();

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.activeElement === ui.promptInput) {
      ui.promptInput.blur();
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && document.activeElement === ui.editorCode) {
      ui.editorCode.blur();
      e.preventDefault();
      return;
    }
    if (document.activeElement === ui.promptInput) return;
    if (document.activeElement === ui.editorCode) return;

    if (e.key === "Escape" && state.editorOpen) {
      setEditorOpen(false);
      e.preventDefault();
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      ui.promptInput.focus();
      ui.promptInput.select();
      return;
    }
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      setEditorOpen(!state.editorOpen);
      return;
    }
    if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      cycleView();
      return;
    }
    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      setHideFeed(!state.hideFeed);
      return;
    }
    if (e.key === "v" || e.key === "V") {
      e.preventDefault();
      if (state.videoSource === "file") {
        useCamera();
      } else {
        ui.sourceFile.click();
      }
      return;
    }
  });

  refreshEditor();
}

function drawDebugView(canvas) {
  const w = outputCanvas.width;
  const h = outputCanvas.height;
  outputCtx.fillStyle = "#000";
  outputCtx.fillRect(0, 0, w, h);
  if (canvas) {
    outputCtx.drawImage(canvas, 0, 0, w, h);
  }
}

async function loop() {
  const now = performance.now();
  if (video.readyState >= 2 && state.detector) {
    captureFrame();
    try {
      const raw = await detect(state.detector, captureCanvas);
      state.objects = state.tracker.update(raw, {
        canvasWidth: captureCanvas.width,
        canvasHeight: captureCanvas.height,
        now,
      });
      state.sceneSignals = computeSceneSignals(state.objects);

      // OpenCV outputs.
      state.foregroundBackground = isForegroundBackgroundReady()
        ? computeForegroundBackground(captureCanvas, { learningRate: 0.04 })
        : null;
      state.sceneEdgeMask = isSceneEdgeMaskReady()
        ? computeSceneEdgeMask(captureCanvas)
        : null;

      const target = effectiveTargetIntensity(now);
      state.currentIntensity += (target - state.currentIntensity) * INTENSITY_SMOOTHING;
      if (state.currentIntensity < 0.001) state.currentIntensity = 0;

      const fgCanvas = getForegroundMaskCanvas();
      const edgeCanvas = getSceneEdgeMaskCanvas();

      if (state.view === "video") {
        drawDebugView(state.hideFeed ? null : captureCanvas);
      } else if (state.view === "fg") {
        drawDebugView(fgCanvas);
      } else if (state.view === "edge") {
        drawDebugView(edgeCanvas);
      } else {
        const drew = shaderRenderer.renderShaderFrame({
          captureCanvas: state.hideFeed ? null : captureCanvas,
          foregroundMaskCanvas: fgCanvas,
          edgeMaskCanvas: edgeCanvas,
          intensity: state.currentIntensity,
          timeMs: now,
        });
        outputCtx.fillStyle = "#000";
        outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
        if (drew) {
          outputCtx.drawImage(shaderRenderer.canvas, 0, 0, outputCanvas.width, outputCanvas.height);
        } else if (!state.hideFeed) {
          outputCtx.drawImage(captureCanvas, 0, 0);
        }
      }

      updateCountBadge(state.objects);
    } catch (err) {
      console.error("[loop] error:", err);
    }
  }
  tickFps(now);
  requestAnimationFrame(loop);
}

async function main() {
  try {
    wireUi();
    await setupCamera();
    setBootStep("loading detector…", 60);
    state.detector = await loadDetector();
    setBootStep("compiling default shader…", 85);
    applyDefaultShader();
    setBootStep("ready", 100);
    setStatus("ready", true);
    hideBoot();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setBootStep(`error: ${err.message || err}`, 100);
    setStatus("error");
  }
}

main();
