const noteNames = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const intervalNames = ['unison', 'minor second', 'major second', 'minor third', 'major third', 'perfect fourth', 'tritone', 'perfect fifth', 'minor sixth', 'major sixth', 'minor seventh', 'major seventh'];
const descriptorMap = {
  0: ['centered', 'settled', 'home'],
  1: ['close', 'aching', 'friction'],
  2: ['searching', 'open', 'stepping'],
  3: ['velvet', 'smoky', 'inward'],
  4: ['clear', 'lifting', 'sunlit'],
  5: ['suspended', 'wide', 'gathering'],
  6: ['electric', 'fractured', 'intense'],
  7: ['open', 'rooted', 'sure'],
  8: ['warm', 'restless', 'turning'],
  9: ['bright', 'expanding', 'alive'],
  10: ['earthy', 'bluesy', 'leaning'],
  11: ['yearning', 'magnetic', 'almost home']
};

const el = {
  canvas: document.getElementById('field'), orb: document.getElementById('orb-button'), orbCopy: document.getElementById('orb-copy'),
  key: document.getElementById('key-select'), octave: document.getElementById('octave-select'), warmth: document.getElementById('warmth'),
  warmthOutput: document.getElementById('warmth-output'), volume: document.getElementById('volume'), volumeOutput: document.getElementById('volume-output'),
  sensitivity: document.getElementById('sensitivity'), sensitivityOutput: document.getElementById('sensitivity-output'),
  mic: document.getElementById('mic-button'), pitch: document.getElementById('pitch-readout'), pitchDetail: document.getElementById('pitch-detail'),
  descriptors: document.getElementById('descriptors'), target: document.getElementById('target-label'), status: document.querySelector('.status'),
  statusText: document.getElementById('status-text'), lessonText: document.getElementById('lesson-text'), lessonMeter: document.getElementById('lesson-meter-fill'),
  about: document.getElementById('about-dialog'), aboutTrigger: document.getElementById('about-trigger'), aboutClose: document.getElementById('about-close'),
  controls: document.getElementById('controls'), controlsTrigger: document.getElementById('controls-trigger'),
  camera: document.getElementById('camera-feed'), cameraTrigger: document.getElementById('camera-trigger'), cameraExit: document.getElementById('camera-exit'),
  cameraControlsTrigger: document.getElementById('camera-controls-trigger'), gestureCanvas: document.getElementById('gesture-canvas'),
  gestureState: document.getElementById('gesture-state'), calibrateGesture: document.getElementById('calibrate-gesture')
};

noteNames.forEach((name, index) => {
  const option = new Option(name, index === 0 ? '0' : String(index));
  el.key.add(option);
});

const state = { audio: null, droneGain: null, droneNodes: [], lfoNodes: [], isDrone: false, analyser: null, micStream: null, cameraStream: null, hands: null, handLoopRunning: false, isListening: false, isCamera: false, isCueMode: false, isCalibrating: false, key: 0, octave: 3, warmth: 54, volume: 48, sensitivity: 56, inputProfile: 'voice', detected: null, targetHistory: [], gestureHold: null, smoothedPose: null, gestureAwaitRelease: false, gestureCalibration: JSON.parse(localStorage.getItem('tonal-field-cue') || 'null'), selectedDescriptors: new Set(JSON.parse(localStorage.getItem('tonal-field-descriptors') || '[]')) };
const ctx = el.canvas.getContext('2d');
const gestureCtx = el.gestureCanvas.getContext('2d');
let lastDescriptorInterval = null;

function noteFrequency(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function selectedMidi() { return 12 * (state.octave + 1) + state.key; }
function midiFromFrequency(frequency) { return 69 + 12 * Math.log2(frequency / 440); }
function centsOff(frequency, midi) { return Math.round(1200 * Math.log2(frequency / noteFrequency(midi))); }
function cleanModulo(value, modulo) { return ((value % modulo) + modulo) % modulo; }

function setupAudio() {
  if (state.audio) return;
  state.audio = new (window.AudioContext || window.webkitAudioContext)();
  state.droneGain = state.audio.createGain();
  state.droneGain.gain.value = 0.0001;
  state.droneGain.connect(state.audio.destination);
}

function stopDroneNodes() {
  state.droneNodes.forEach(node => { try { node.stop(); } catch {} });
  state.lfoNodes.forEach(node => { try { node.stop(); } catch {} });
  state.droneNodes = []; state.lfoNodes = [];
}

function buildDrone() {
  setupAudio();
  stopDroneNodes();
  const now = state.audio.currentTime;
  const fundamental = noteFrequency(selectedMidi());
  const harmonicMix = [1, .09, .035, .012];
  const warmth = state.warmth / 100;
  harmonicMix.forEach((level, index) => {
    const oscillator = state.audio.createOscillator();
    const partialGain = state.audio.createGain();
    const lfo = state.audio.createOscillator();
    const lfoGain = state.audio.createGain();
    const filter = state.audio.createBiquadFilter();
    const harmonicAmount = index === 0 ? 1 : Math.pow(warmth, index * .78);
    oscillator.type = 'sine';
    oscillator.frequency.value = fundamental * (index + 1);
    oscillator.detune.value = index === 0 ? 0 : (index % 2 ? 1.8 : -1.4);
    partialGain.gain.value = level * harmonicAmount;
    filter.type = 'lowpass';
    filter.frequency.value = 620 + warmth * 1500;
    filter.Q.value = .18;
    lfo.frequency.value = .018 + index * .009;
    lfoGain.gain.value = Math.max(.0004, partialGain.gain.value * (.025 + warmth * .05));
    lfo.connect(lfoGain).connect(partialGain.gain);
    oscillator.connect(partialGain).connect(filter).connect(state.droneGain);
    oscillator.start(now); lfo.start(now);
    state.droneNodes.push(oscillator); state.lfoNodes.push(lfo);
  });
}

async function toggleDrone() {
  setupAudio();
  await state.audio.resume();
  state.isDrone = !state.isDrone;
  if (state.isDrone) {
    buildDrone();
    state.droneGain.gain.cancelScheduledValues(state.audio.currentTime);
    state.droneGain.gain.linearRampToValueAtTime((state.volume / 100) * .18, state.audio.currentTime + 1.4);
  } else {
    state.droneGain.gain.cancelScheduledValues(state.audio.currentTime);
    state.droneGain.gain.linearRampToValueAtTime(.0001, state.audio.currentTime + .7);
    setTimeout(stopDroneNodes, 850);
  }
  updateControls();
}

function updateDrone() {
  if (!state.isDrone) return;
  state.droneGain.gain.linearRampToValueAtTime((state.volume / 100) * .18, state.audio.currentTime + .12);
  buildDrone();
}

async function startListening() {
  if (state.isListening) return stopListening();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    setupAudio();
    state.analyser = state.audio.createAnalyser();
    state.analyser.fftSize = 2048;
    state.analyser.smoothingTimeConstant = .2;
    state.audio.createMediaStreamSource(stream).connect(state.analyser);
    state.micStream = stream;
    state.isListening = true;
    updateControls();
  } catch (error) {
    el.lessonText.textContent = 'Microphone access was not available. You can still explore the drone.';
    el.pitchDetail.textContent = 'microphone permission needed';
  }
}

function stopListening() {
  state.micStream?.getTracks().forEach(track => track.stop());
  state.micStream = null; state.analyser = null; state.isListening = false; state.detected = null;
  updateControls();
}

async function enterCamera() {
  if (state.isCamera) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    state.cameraStream = stream;
    el.camera.srcObject = stream;
    await el.camera.play();
    state.isCamera = true;
    document.body.classList.add('camera-active');
    setControlsCollapsed(true);
    startHandTracking();
  } catch (error) {
    el.lessonText.textContent = 'Camera access was not available. You can keep practicing in the tonal field.';
    el.pitchDetail.textContent = 'camera permission needed';
  }
}

function exitCamera() {
  state.cameraStream?.getTracks().forEach(track => track.stop());
  state.cameraStream = null;
  el.camera.srcObject = null;
  state.isCamera = false;
  state.handLoopRunning = false;
  state.gestureHold = null;
  state.smoothedPose = null;
  state.gestureAwaitRelease = false;
  clearGestureCanvas();
  document.body.classList.remove('camera-active');
  setControlsCollapsed(true);
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function averagePoint(points) {
  return points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y, z: total.z + (point.z || 0) }), { x: 0, y: 0, z: 0 });
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : { x: 0, y: 0, z: 0 };
}

function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

function handPose(landmarks) {
  const knuckles = [5, 9, 13, 17].map(index => landmarks[index]);
  const centerTotal = averagePoint(knuckles);
  const center = { x: centerTotal.x / knuckles.length, y: centerTotal.y / knuckles.length, z: centerTotal.z / knuckles.length };
  const width = Math.max(pointDistance(landmarks[5], landmarks[17]), .001);
  const ratios = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, pip]) => pointDistance(landmarks[tip], landmarks[0]) / Math.max(pointDistance(landmarks[pip], landmarks[0]), .001));
  const a = { x: landmarks[5].x - landmarks[0].x, y: landmarks[5].y - landmarks[0].y, z: landmarks[5].z - landmarks[0].z };
  const b = { x: landmarks[17].x - landmarks[0].x, y: landmarks[17].y - landmarks[0].y, z: landmarks[17].z - landmarks[0].z };
  const normal = normalize({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  return { center, width, ratios, normal };
}

function isClosedFist(pose) {
  return pose.ratios.filter(ratio => ratio < 1.1).length >= 3;
}

function matchesCalibration(pose) {
  if (!state.gestureCalibration) return true;
  const ratioDifference = pose.ratios.reduce((total, ratio, index) => total + Math.abs(ratio - state.gestureCalibration.ratios[index]), 0) / pose.ratios.length;
  return ratioDifference < .22 && dot(pose.normal, state.gestureCalibration.normal) > .45;
}

function isSteady(pose, reference) {
  return pointDistance(pose.center, reference.center) < .11 && dot(pose.normal, reference.normal) > .35;
}

function blendPose(from, to, amount) {
  const blendPoint = (a, b) => ({ x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount, z: a.z + (b.z - a.z) * amount });
  return {
    center: blendPoint(from.center, to.center),
    width: from.width + (to.width - from.width) * amount,
    ratios: from.ratios.map((ratio, index) => ratio + (to.ratios[index] - ratio) * amount),
    normal: normalize(blendPoint(from.normal, to.normal))
  };
}

function smoothPose(pose) {
  state.smoothedPose = state.smoothedPose ? blendPose(state.smoothedPose, pose, .24) : pose;
  return state.smoothedPose;
}

function clearGestureCanvas() {
  gestureCtx.clearRect(0, 0, el.gestureCanvas.width, el.gestureCanvas.height);
}

function resizeGestureCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (el.gestureCanvas.width !== width * ratio || el.gestureCanvas.height !== height * ratio) {
    el.gestureCanvas.width = width * ratio;
    el.gestureCanvas.height = height * ratio;
    gestureCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
}

function drawGestureCue(pose, progress, mode) {
  resizeGestureCanvas();
  clearGestureCanvas();
  const x = (1 - pose.center.x) * window.innerWidth;
  const y = pose.center.y * window.innerHeight;
  const radius = Math.max(42, Math.min(92, pose.width * window.innerWidth * .76));
  const color = mode === 'calibrate' ? '196, 215, 162' : state.isCueMode ? '232, 202, 123' : '235, 163, 179';
  gestureCtx.lineCap = 'round';
  gestureCtx.beginPath();
  gestureCtx.arc(x, y, radius + 11, 0, Math.PI * 2);
  gestureCtx.strokeStyle = `rgba(${color}, .12)`;
  gestureCtx.lineWidth = 1;
  gestureCtx.stroke();
  gestureCtx.beginPath();
  gestureCtx.arc(x, y, radius, -Math.PI / 2, Math.PI * 1.5);
  gestureCtx.strokeStyle = `rgba(${color}, .24)`;
  gestureCtx.lineWidth = 3;
  gestureCtx.stroke();
  gestureCtx.beginPath();
  gestureCtx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  gestureCtx.strokeStyle = `rgba(${color}, .96)`;
  gestureCtx.lineWidth = 3;
  gestureCtx.shadowBlur = 16;
  gestureCtx.shadowColor = `rgb(${color})`;
  gestureCtx.stroke();
  gestureCtx.shadowBlur = 0;
  const countdown = Math.max(1, 3 - Math.floor(progress * 3));
  gestureCtx.fillStyle = 'rgba(255, 249, 238, .96)';
  gestureCtx.font = '500 22px Inter, system-ui, sans-serif';
  gestureCtx.textAlign = 'center';
  gestureCtx.textBaseline = 'middle';
  gestureCtx.fillText(String(countdown), x, y - 5);
  gestureCtx.fillStyle = `rgba(${color}, .88)`;
  gestureCtx.font = '500 9px Inter, system-ui, sans-serif';
  gestureCtx.fillText(mode === 'calibrate' ? 'SAVE CUE' : state.isCueMode ? 'EXIT CUE MODE' : 'ENTER CUE MODE', x, y + 17);
}

function updateGestureState(text) {
  el.gestureState.textContent = text;
}

function resetGestureHold() {
  state.gestureHold = null;
  clearGestureCanvas();
  if (state.isCamera && !state.isCalibrating) updateGestureState(state.isCueMode ? 'hold a fist to exit cue mode' : 'hold a fist to cue');
}

function saveCalibration(pose) {
  state.gestureCalibration = { ratios: pose.ratios, normal: pose.normal };
  localStorage.setItem('tonal-field-cue', JSON.stringify(state.gestureCalibration));
  state.isCalibrating = false;
  state.gestureAwaitRelease = true;
  resetGestureHold();
  updateGestureState('cue saved · release your hand');
}

function toggleCueMode() {
  state.isCueMode = !state.isCueMode;
  state.gestureAwaitRelease = true;
  resetGestureHold();
  updateControls();
  updateGestureState(state.isCueMode ? 'cue mode · release your hand' : 'cue mode released · release your hand');
}

function evaluateGesture(pose) {
  const mode = state.isCalibrating ? 'calibrate' : 'cue';
  const candidate = isClosedFist(pose) && (state.isCalibrating || matchesCalibration(pose));
  if (!candidate) {
    if (state.gestureAwaitRelease) state.gestureAwaitRelease = false;
    resetGestureHold();
    return;
  }
  if (state.gestureAwaitRelease) return;
  const now = performance.now();
  if (!state.gestureHold || !isSteady(pose, state.gestureHold.pose)) state.gestureHold = { pose, startedAt: now };
  else state.gestureHold.pose = blendPose(state.gestureHold.pose, pose, .07);
  const progress = Math.min(1, (now - state.gestureHold.startedAt) / 3000);
  updateGestureState(state.isCalibrating ? 'hold steady to save your cue' : state.isCueMode ? 'hold steady to leave cue mode' : 'hold steady to enter cue mode');
  drawGestureCue(pose, progress, mode);
  if (progress >= 1) {
    if (state.isCalibrating) saveCalibration(pose); else toggleCueMode();
  }
}

function onHandResults(results) {
  const landmarks = results.multiHandLandmarks?.[0];
  if (!landmarks) {
    if (state.gestureAwaitRelease) state.gestureAwaitRelease = false;
    state.smoothedPose = null;
    resetGestureHold();
    return;
  }
  evaluateGesture(smoothPose(handPose(landmarks)));
}

async function handTrackingLoop() {
  if (!state.handLoopRunning || !state.isCamera) return;
  if (el.camera.readyState >= 2) await state.hands.send({ image: el.camera });
  requestAnimationFrame(handTrackingLoop);
}

function startHandTracking() {
  if (state.handLoopRunning) return;
  if (typeof window.Hands !== 'function') {
    updateGestureState('hand tracking unavailable');
    return;
  }
  if (!state.hands) {
    state.hands = new window.Hands({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    state.hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: .66, minTrackingConfidence: .62 });
    state.hands.onResults(onHandResults);
  }
  state.handLoopRunning = true;
  updateGestureState(state.isCueMode ? 'hold a fist to exit cue mode' : 'hold a fist to cue');
  handTrackingLoop();
}

async function beginGestureCalibration() {
  if (!state.isCamera) await enterCamera();
  if (!state.isCamera) return;
  state.isCalibrating = true;
  state.gestureAwaitRelease = false;
  resetGestureHold();
  setControlsCollapsed(true);
  updateGestureState('show your cue fist · knuckles to camera');
}

function autoCorrelate(buffer, sampleRate) {
  let rms = 0;
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) { rms += buffer[i] * buffer[i]; peak = Math.max(peak, Math.abs(buffer[i])); }
  rms = Math.sqrt(rms / buffer.length);
  const sensitivityScale = 1.35 - state.sensitivity * .008;
  const profileGate = (state.inputProfile === 'voice' ? .0028 : .0022) * sensitivityScale;
  if (rms < profileGate || peak < .012) return null;
  const size = buffer.length;
  let start = 0; let end = size - 1;
  const trimThreshold = Math.max(.006, peak * .16);
  while (start < size / 2 && Math.abs(buffer[start]) < trimThreshold) start++;
  while (end > size / 2 && Math.abs(buffer[end]) < trimThreshold) end--;
  const trimmed = buffer.slice(start, end);
  const correlations = new Float32Array(trimmed.length);
  for (let lag = 0; lag < trimmed.length; lag++) {
    for (let i = 0; i < trimmed.length - lag; i++) correlations[lag] += trimmed[i] * trimmed[i + lag];
  }
  let dip = 0;
  while (dip + 1 < correlations.length && correlations[dip] > correlations[dip + 1]) dip++;
  let max = -1; let maxIndex = -1;
  for (let i = dip; i < correlations.length; i++) {
    if (correlations[i] > max) { max = correlations[i]; maxIndex = i; }
  }
  if (correlations[0] <= 0) return null;
  const normalizedPeak = max / correlations[0];
  if (maxIndex <= 0 || normalizedPeak < .26) return null;
  const left = correlations[maxIndex - 1] || correlations[maxIndex];
  const right = correlations[maxIndex + 1] || correlations[maxIndex];
  const shift = (right - left) / (2 * (2 * correlations[maxIndex] - right - left));
  const period = maxIndex + (Number.isFinite(shift) ? shift : 0);
  const frequency = sampleRate / period;
  const range = state.inputProfile === 'voice' ? [72, 980] : [55, 1550];
  return frequency >= range[0] && frequency <= range[1] ? { frequency, confidence: Math.min(1, rms * 90) } : null;
}

function readPitch() {
  if (!state.analyser || !state.audio) return;
  const buffer = new Float32Array(state.analyser.fftSize);
  state.analyser.getFloatTimeDomainData(buffer);
  const result = autoCorrelate(buffer, state.audio.sampleRate);
  if (!result) { state.detected = null; return; }
  const midi = Math.round(midiFromFrequency(result.frequency));
  const cents = centsOff(result.frequency, midi);
  state.detected = { ...result, midi, cents, interval: cleanModulo(midi - selectedMidi(), 12) };
}

function updateDescriptors(interval) {
  if (interval === lastDescriptorInterval) return;
  lastDescriptorInterval = interval;
  el.descriptors.innerHTML = '';
  descriptorMap[interval].forEach((word, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'descriptor'; button.textContent = word;
    button.setAttribute('aria-pressed', state.selectedDescriptors.has(word));
    if (state.selectedDescriptors.has(word)) button.classList.add('selected');
    button.addEventListener('click', () => {
      if (state.selectedDescriptors.has(word)) state.selectedDescriptors.delete(word); else state.selectedDescriptors.add(word);
      localStorage.setItem('tonal-field-descriptors', JSON.stringify([...state.selectedDescriptors]));
      button.classList.toggle('selected'); button.setAttribute('aria-pressed', state.selectedDescriptors.has(word));
    });
    el.descriptors.append(button);
    setTimeout(() => button.classList.add('visible'), 90 + index * 100);
  });
}

function updateControls() {
  el.orb.classList.toggle('active', state.isDrone); el.orb.setAttribute('aria-pressed', state.isDrone);
  el.orbCopy.innerHTML = state.isCueMode ? 'cue<br />ready' : state.isListening ? 'listen<br />within' : state.isDrone ? 'release<br />home' : 'hold<br />home';
  document.body.classList.toggle('is-listening', state.isListening);
  document.body.classList.toggle('is-cue-mode', state.isCueMode);
  el.status.classList.toggle('active', state.isDrone || state.isListening);
  el.statusText.textContent = state.isListening ? 'FIELD LISTENING' : state.isDrone ? 'DRONE OPEN' : 'DRONE STANDBY';
  el.mic.classList.toggle('active', state.isListening); el.mic.textContent = state.isListening ? 'listening · stop' : 'enable listening';
  el.volumeOutput.value = `${state.volume}%`;
  el.warmthOutput.value = state.warmth < 35 ? 'pure' : state.warmth < 72 ? 'warm' : 'blooming';
  el.sensitivityOutput.value = state.sensitivity < 35 ? 'focused' : state.sensitivity < 72 ? 'balanced' : 'open';
  el.target.textContent = state.isCueMode ? `CUE MODE · ${noteNames[state.key]}` : state.isListening ? `LISTENING · FIND ${noteNames[state.key]}` : `TONIC · ${noteNames[state.key]}`;
}

function draw(time) {
  const { width, height } = el.canvas;
  const centerX = width / 2; const centerY = height / 2;
  ctx.clearRect(0, 0, width, height);
  const t = time / 1000;
  const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, width * .48);
  glow.addColorStop(0, state.isDrone ? 'rgba(255,183,90,.10)' : 'rgba(141,125,255,.035)'); glow.addColorStop(.55, 'rgba(116,87,177,.025)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
  for (let index = 0; index < 6; index++) {
    const radius = 160 + index * 62 + Math.sin(t * (.34 + index * .03) + index) * (state.isDrone ? 9 : 2);
    ctx.beginPath(); ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(221, 208, 240, ${.035 - index * .003})`; ctx.lineWidth = 1; ctx.stroke();
  }
  if (state.isListening) {
    for (let petal = 0; petal < 12; petal++) {
      const angle = petal / 12 * Math.PI * 2 + t * .12;
      const radius = 220 + Math.sin(t * 1.4 + petal * .9) * 16;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius * .79;
      ctx.beginPath(); ctx.arc(x, y, 2.5 + Math.sin(t * 2 + petal) * .8, 0, Math.PI * 2);
      ctx.fillStyle = petal % 3 === 0 ? 'rgba(224, 134, 159, .66)' : 'rgba(208, 184, 111, .42)'; ctx.fill();
    }
  }
  if (state.detected) {
    const interval = state.detected.interval;
    const pitchDelta = state.detected.midi - selectedMidi();
    const angle = -Math.PI / 2 + interval / 12 * Math.PI * 2;
    const radius = 135 + Math.min(160, Math.abs(pitchDelta) * 14);
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius * .8;
    const tension = Math.min(Math.abs(interval - 6) / 6, 1);
    const color = interval === 6 ? '255,110,127' : interval === 0 || interval === 7 ? '255,196,105' : '162,144,255';
    ctx.beginPath(); ctx.moveTo(centerX, centerY); ctx.quadraticCurveTo(centerX + Math.cos(angle + .7) * radius * .2, centerY + Math.sin(angle + .7) * radius * .2, x, y);
    ctx.strokeStyle = `rgba(${color}, .72)`; ctx.lineWidth = 2 + tension * 2; ctx.shadowBlur = 22; ctx.shadowColor = `rgb(${color})`; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(x, y, 12 + Math.sin(t * 4) * 2, 0, Math.PI * 2); ctx.fillStyle = `rgba(${color}, .95)`; ctx.shadowBlur = 25; ctx.shadowColor = `rgb(${color})`; ctx.fill(); ctx.shadowBlur = 0;
  }
  requestAnimationFrame(draw);
}

function updateLiveCopy() {
  if (!state.detected) {
    if (state.isListening) {
      el.pitch.textContent = 'listen'; el.pitchDetail.textContent = 'offer one clear note';
      el.lessonText.textContent = 'The field is open. Sustain a note and let it show you its distance from home.';
      el.lessonMeter.style.width = '54%';
    }
    return;
  }
  const { midi, cents, interval } = state.detected;
  const centsLabel = cents === 0 ? 'in tune' : `${Math.abs(cents)}¢ ${cents > 0 ? 'bright' : 'low'}`;
  el.pitch.textContent = noteNames[cleanModulo(midi, 12)];
  el.pitchDetail.textContent = `${intervalNames[interval]} · ${centsLabel}`;
  updateDescriptors(interval);
  const messages = { 0: 'You found home. Let it settle.', 6: 'Let the tension stay alive before you resolve it.', 7: 'A stable frame. Notice how it holds the center.', 11: 'Almost home. Can you feel where it wants to go?' };
  el.lessonText.textContent = messages[interval] || `Notice the ${intervalNames[interval]}. Does this language land for you?`;
  el.lessonMeter.style.width = `${Math.min(100, 22 + (12 - Math.abs(interval - 6)) * 6)}%`;
}

el.orb.addEventListener('click', toggleDrone);
el.mic.addEventListener('click', startListening);
el.key.addEventListener('change', event => { state.key = Number(event.target.value); updateDrone(); updateControls(); });
el.octave.addEventListener('change', event => { state.octave = Number(event.target.value); updateDrone(); });
document.getElementById('input-profile').addEventListener('change', event => {
  state.inputProfile = event.target.value;
  el.pitchDetail.textContent = `${state.inputProfile} profile active`;
});
el.warmth.addEventListener('input', event => { state.warmth = Number(event.target.value); updateControls(); if (state.isDrone) updateDrone(); });
el.volume.addEventListener('input', event => { state.volume = Number(event.target.value); updateControls(); if (state.isDrone) state.droneGain.gain.linearRampToValueAtTime((state.volume / 100) * .18, state.audio.currentTime + .08); });
el.sensitivity.addEventListener('input', event => { state.sensitivity = Number(event.target.value); updateControls(); });
el.aboutTrigger.addEventListener('click', () => el.about.showModal());
el.aboutClose.addEventListener('click', () => el.about.close());
el.about.addEventListener('click', event => { if (event.target === el.about) el.about.close(); });
function setControlsCollapsed(collapsed) {
  el.controls.classList.toggle('is-collapsed', collapsed);
  el.controlsTrigger.setAttribute('aria-expanded', String(!collapsed));
  el.cameraControlsTrigger.setAttribute('aria-expanded', String(!collapsed));
  el.controlsTrigger.textContent = collapsed ? 'tune field' : 'hide controls';
  el.cameraControlsTrigger.textContent = collapsed ? 'tune' : 'hide';
}

function toggleControls() { setControlsCollapsed(!el.controls.classList.contains('is-collapsed')); }

el.controlsTrigger.addEventListener('click', toggleControls);
el.cameraControlsTrigger.addEventListener('click', toggleControls);
el.cameraTrigger.addEventListener('click', enterCamera);
el.cameraExit.addEventListener('click', exitCamera);
el.calibrateGesture.addEventListener('click', beginGestureCalibration);
window.addEventListener('resize', clearGestureCanvas);

updateDescriptors(0); updateControls(); requestAnimationFrame(draw);
setInterval(() => { readPitch(); updateLiveCopy(); }, 70);
