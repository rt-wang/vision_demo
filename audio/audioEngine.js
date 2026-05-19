/*
 * Audio engine — driven by the actual output canvas color each frame.
 *
 * Graph:
 *   AudioBufferSourceNode (loop)
 *     → masterGain
 *     → filterNode       (lowpass, cutoff from hue)
 *     → distortionNode   (soft clip, amount from saturation — capped low)
 *     → tremoloAmp       (LFO from scene motion)
 *     → highShelf        (treble boost from yellow proximity — "heavenly")
 *         → dryGain                        → destination
 *         → convolver → wetGain            → destination  (reverb, from lightness)
 *         → delayNode ↔ feedbackGain loop
 *             → echoWetGain               → destination  (echo, from blue proximity)
 *
 * Color mapping:
 *   Hue       → lowpass cutoff 500Hz–16kHz  (red=dark, blue=bright)
 *   Hue~60°   → high-shelf treble boost     (yellow = sparkly/heavenly)
 *   Hue~220°  → delay echo wet + feedback   (blue = spacious echo)
 *   Saturation → soft distortion (max ~20) + filter resonance
 *   Lightness  → reverb wet mix
 *   Motion     → tremolo rate + depth
 */

function buildImpulseResponse(ctx, duration = 2.8, decay = 2.8) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * duration);
  const buf = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buf;
}

function buildDistortionCurve(amount) {
  const n = 512;
  const curve = new Float32Array(n);
  const k = Math.max(0.001, amount);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// Map hue 0–360 to filter cutoff on a log scale (500Hz → 16kHz).
function hueToFreq(hue) {
  return 500 * Math.pow(16000 / 500, hue / 360);
}

// How close is `hue` to `target` (degrees), falling off over `width` degrees.
function hueProximity(hue, target, width) {
  let d = Math.abs(hue - target);
  if (d > 180) d = 360 - d;
  return Math.max(0, 1 - d / width);
}

export function createAudioEngine() {
  let ctx = null;
  let sourceNode = null;
  let audioBuffer = null;

  let masterGain = null;
  let streamDest = null; // MediaStreamDestinationNode for recording
  let filterNode = null;
  let distortionNode = null;
  let tremoloAmp = null;
  let tremoloLFO = null;
  let tremoloDepth = null;
  let highShelf = null;
  let dryGain = null;
  let convolver = null;
  let wetGain = null;
  let delayNode = null;
  let feedbackGain = null;
  let echoWetGain = null;

  let lastDistAmount = -1;
  let smoothH = 180;
  let smoothS = 0;
  let smoothL = 0.5;

  function buildGraph() {
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.8;

    filterNode = ctx.createBiquadFilter();
    filterNode.type = "lowpass";
    filterNode.frequency.value = hueToFreq(smoothH);
    filterNode.Q.value = 1;

    distortionNode = ctx.createWaveShaper();
    distortionNode.curve = buildDistortionCurve(0);
    distortionNode.oversample = "4x";

    tremoloAmp = ctx.createGain();
    tremoloAmp.gain.value = 1.0;
    tremoloLFO = ctx.createOscillator();
    tremoloLFO.type = "sine";
    tremoloLFO.frequency.value = 3;
    tremoloDepth = ctx.createGain();
    tremoloDepth.gain.value = 0;
    tremoloLFO.connect(tremoloDepth);
    tremoloDepth.connect(tremoloAmp.gain);
    tremoloLFO.start();

    // High shelf for yellow hues — boosts everything above 3.5kHz.
    highShelf = ctx.createBiquadFilter();
    highShelf.type = "highshelf";
    highShelf.frequency.value = 3500;
    highShelf.gain.value = 0;

    dryGain = ctx.createGain();
    dryGain.gain.value = 0.85;

    convolver = ctx.createConvolver();
    convolver.buffer = buildImpulseResponse(ctx);
    wetGain = ctx.createGain();
    wetGain.gain.value = 0.15;

    // Delay with feedback for blue hues.
    delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = 0.36;
    feedbackGain = ctx.createGain();
    feedbackGain.gain.value = 0;
    echoWetGain = ctx.createGain();
    echoWetGain.gain.value = 0;

    // Wire it all up.
    masterGain.connect(filterNode);
    filterNode.connect(distortionNode);
    distortionNode.connect(tremoloAmp);
    tremoloAmp.connect(highShelf);

    highShelf.connect(dryGain);
    highShelf.connect(convolver);
    highShelf.connect(delayNode);

    delayNode.connect(feedbackGain);
    delayNode.connect(echoWetGain);
    feedbackGain.connect(delayNode); // feedback loop

    dryGain.connect(ctx.destination);
    convolver.connect(wetGain);
    wetGain.connect(ctx.destination);
    echoWetGain.connect(ctx.destination);

    // Mirror all output to a MediaStream so the recorder can capture audio.
    streamDest = ctx.createMediaStreamDestination();
    dryGain.connect(streamDest);
    wetGain.connect(streamDest);
    echoWetGain.connect(streamDest);
  }

  function ensureContext() {
    if (ctx) return;
    ctx = new AudioContext();
    buildGraph();
  }

  function startSource() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (_) { /* already stopped */ }
      sourceNode.disconnect();
    }
    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.loop = true;
    sourceNode.connect(masterGain);
    sourceNode.start(0);
  }

  async function loadFile(file) {
    ensureContext();
    if (ctx.state === "suspended") await ctx.resume();
    const arrayBuffer = await file.arrayBuffer();
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    startSource();
  }

  function setVolume(intensity) {
    if (!masterGain) return;
    masterGain.gain.setTargetAtTime(intensity, ctx.currentTime, 0.05);
  }

  // Neutral filter frequency — audio sounds unaffected when at this value.
  const NEUTRAL_FREQ = 9000;

  function updateFromColor(h, s, l) {
    if (!ctx) return;
    const t = ctx.currentTime;

    // Smooth incoming values to avoid frame-to-frame clicks.
    const a = 0.08;
    let dh = h - smoothH;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    smoothH = (smoothH + dh * a + 360) % 360;
    smoothS += (s - smoothS) * a;
    smoothL += (l - smoothL) * a;

    // How strongly color effects apply — ramps 0→1 as lightness goes 0→0.4.
    // Below that threshold (dark/black screen) everything fades to neutral.
    const strength = Math.min(1, smoothL / 0.4);

    // Hue → lowpass cutoff, blended toward neutral when dark.
    const freqTarget = NEUTRAL_FREQ + (hueToFreq(smoothH) - NEUTRAL_FREQ) * strength;
    filterNode.frequency.setTargetAtTime(freqTarget, t, 0.15);

    // Saturation → mild resonance, scaled by strength.
    filterNode.Q.setTargetAtTime(0.5 + smoothS * 3.5 * strength, t, 0.2);

    // Saturation → soft distortion, capped at 20, scaled by strength.
    const distTarget = Math.pow(smoothS, 1.4) * 20 * strength;
    if (Math.abs(distTarget - lastDistAmount) > 1) {
      distortionNode.curve = buildDistortionCurve(distTarget);
      lastDistAmount = distTarget;
    }

    // Lightness → reverb wet mix (independent — dark = dry is intentional).
    const wetTarget = smoothL * 0.85;
    wetGain.gain.setTargetAtTime(wetTarget, t, 0.3);
    dryGain.gain.setTargetAtTime(1 - wetTarget * 0.55, t, 0.3);

    // Yellow hue (~60°) → high-shelf treble boost, scaled by strength.
    const yellowProx = hueProximity(smoothH, 60, 65);
    highShelf.gain.setTargetAtTime(yellowProx * 10 * strength, t, 0.5);

    // Blue hue (~220°) → echo, scaled by strength.
    const blueProx = hueProximity(smoothH, 220, 80);
    feedbackGain.gain.setTargetAtTime(blueProx * 0.45 * strength, t, 0.6);
    echoWetGain.gain.setTargetAtTime(blueProx * 0.38 * strength, t, 0.6);
  }

  function updateFromSignals(signals) {
    if (!ctx || !signals) return;
    const { averageMotion = 0 } = signals;
    const t = ctx.currentTime;
    tremoloLFO.frequency.setTargetAtTime(1 + averageMotion * 7, t, 0.3);
    tremoloDepth.gain.setTargetAtTime(averageMotion * 0.4, t, 0.3);
  }

  function updateFromShader() {}

  // Returns the audio MediaStream for recording, or null if not yet initialised.
  function getAudioStream() {
    return streamDest ? streamDest.stream : null;
  }

  function dispose() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (_) { /* ignore */ }
    }
    if (ctx) ctx.close();
    ctx = null;
    sourceNode = null;
    audioBuffer = null;
  }

  return { loadFile, setVolume, updateFromColor, updateFromShader, updateFromSignals, getAudioStream, dispose };
}
