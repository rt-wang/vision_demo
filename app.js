/*
 * VISION ∙ live cv playground
 *
 * Pipeline:
 *   getUserMedia → hidden <video>
 *     → captureCanvas (per-frame buffer that analysis reads from)
 *       → active mode's process() draws into outputCanvas
 *
 * Modes are objects with { id, label, init, process, dispose }, so adding
 * a fifth mode is just a matter of dropping another entry into MODES.
 */

import { LinesMode } from "./modes/lines.js";
import { DepthMode } from "./modes/depth.js";
import { ObjectsMode } from "./modes/objects.js";
import { SegmentMode } from "./modes/segment.js";

const video = document.getElementById("video");
const outputCanvas = document.getElementById("output");
const outputCtx = outputCanvas.getContext("2d");

// Un-mirrored frame buffer used by all analysis code.
const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

const ui = {
  fps: document.getElementById("fps"),
  status: document.getElementById("status"),
  modeBadge: document.getElementById("modeBadge"),
  chips: Array.from(document.querySelectorAll(".chip")),
  boot: document.getElementById("boot"),
  bootStep: document.getElementById("bootStep"),
  bootBar: document.getElementById("bootBar"),
};

const MODES = {
  lines: LinesMode,
  depth: DepthMode,
  objects: ObjectsMode,
  segment: SegmentMode,
};

const state = {
  modeId: "lines",
  initialized: new Set(),
  fpsAcc: { last: performance.now(), frames: 0 },
};

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

async function setupCamera() {
  setBootStep("requesting camera…", 10);
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user",
    },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play();

  sizeCanvases();
  setBootStep("camera ready", 40);
}

function sizeCanvases() {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  // Internal pixel size = source resolution. CSS scales to fit container.
  outputCanvas.width = w;
  outputCanvas.height = h;
  captureCanvas.width = w;
  captureCanvas.height = h;
}

async function waitForOpenCV() {
  if (window.cv && window.cv.Mat) return;
  setBootStep("loading opencv…", 55);
  await new Promise((resolve, reject) => {
    const start = performance.now();
    const tick = () => {
      if (window.cv && window.cv.Mat) return resolve();
      if (window.cv && typeof window.cv.then === "function") {
        // Some builds expose cv as a thenable while initializing.
        window.cv.then(resolve).catch(reject);
        return;
      }
      if (window.__cvReady && window.cv && window.cv.onRuntimeInitialized) {
        window.cv.onRuntimeInitialized = () => resolve();
        return;
      }
      if (performance.now() - start > 15000) return reject(new Error("opencv load timeout"));
      setTimeout(tick, 60);
    };
    tick();
  });
}

async function ensureModeInitialized(modeId) {
  const mode = MODES[modeId];
  if (state.initialized.has(modeId)) return mode;
  setStatus(`loading ${mode.label.toLowerCase()}…`);
  await mode.init({ video, captureCanvas, captureCtx, outputCanvas, outputCtx });
  state.initialized.add(modeId);
  setStatus("ready", true);
  return mode;
}

function captureFrame() {
  // Draw the raw (un-mirrored) video frame into the capture buffer.
  captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
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

let lastProcessedMode = null;

async function loop() {
  const mode = MODES[state.modeId];
  if (mode && state.initialized.has(state.modeId) && video.readyState >= 2) {
    captureFrame();
    try {
      await mode.process({
        video,
        captureCanvas,
        captureCtx,
        outputCanvas,
        outputCtx,
      });
    } catch (err) {
      console.error(`[${state.modeId}] process error:`, err);
    }
    lastProcessedMode = state.modeId;
  }
  tickFps(performance.now());
  requestAnimationFrame(loop);
}

async function switchMode(nextId) {
  if (!MODES[nextId] || nextId === state.modeId) return;
  const prev = state.modeId;
  state.modeId = nextId;
  ui.modeBadge.textContent = MODES[nextId].label.toUpperCase();
  ui.chips.forEach((chip) => {
    const active = chip.dataset.mode === nextId;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-selected", active ? "true" : "false");
  });
  try {
    await ensureModeInitialized(nextId);
  } catch (err) {
    console.error(`[${nextId}] init failed:`, err);
    setStatus(`failed: ${nextId}`, false);
    // Roll back to previous mode UI selection.
    state.modeId = prev;
    ui.modeBadge.textContent = MODES[prev].label.toUpperCase();
    ui.chips.forEach((chip) => {
      const active = chip.dataset.mode === prev;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-selected", active ? "true" : "false");
    });
  }
}

function wireUi() {
  ui.chips.forEach((chip) => {
    chip.addEventListener("click", () => switchMode(chip.dataset.mode));
  });
  window.addEventListener("keydown", (e) => {
    const map = { "1": "lines", "2": "depth", "3": "objects", "4": "segment" };
    if (map[e.key]) switchMode(map[e.key]);
  });
}

async function main() {
  try {
    wireUi();
    await setupCamera();
    await waitForOpenCV();
    setBootStep("warming up…", 80);
    await ensureModeInitialized("lines");
    setBootStep("ready", 100);
    hideBoot();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setBootStep(`error: ${err.message || err}`, 100);
    setStatus("error");
  }
}

main();
