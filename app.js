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
  gestureState: document.getElementById('gesture-state'), calibrateGesture: document.getElementById('calibrate-gesture'),
  recordCueMotion: document.getElementById('record-cue-motion'), microphone: document.getElementById('microphone-select')
};

noteNames.forEach((name, index) => {
  const option = new Option(name, index === 0 ? '0' : String(index));
  el.key.add(option);
});

const state = { audio: null, droneGain: null, droneNodes: [], lfoNodes: [], isDrone: false, analyser: null, micStream: null, micSource: null, microphoneId: localStorage.getItem('tonal-field-microphone') || 'default', cameraStream: null, hands: null, handLoopRunning: false, isListening: false, isCamera: false, isCueMode: false, isCalibrating: false, cueRecording: null, cueGate: null, autoTeachOnRelease: false, key: 0, octave: 3, warmth: 54, volume: 48, sensitivity: 56, inputProfile: 'voice', detected: null, targetHistory: [], gestureHold: null, smoothedPose: null, gestureAwaitRelease: false, motionBuffer: [], stopBuffer: [], cueCooldownUntil: 0, stopCooldownUntil: 0, currentHandLabel: null, activeCueHandLabel: null, cueTemplates: JSON.parse(localStorage.getItem('tonal-field-cue-motion') || '[]'), gestureCalibration: JSON.parse(localStorage.getItem('tonal-field-cue') || 'null'), selectedDescriptors: new Set(JSON.parse(localStorage.getItem('tonal-field-descriptors') || '[]')) };
const ctx = el.canvas.getContext('2d');
const gestureCtx = el.gestureCanvas.getContext('2d');
let lastDescriptorInterval = null;
const CUE_ARM_MS = 320;
const CUE_CAPTURE_MS = 1100;
const CUE_START_DISTANCE = .048;
const CUE_MATCH_THRESHOLD = .245;

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

function clearStopBuffer() {
  state.stopBuffer = [];
}

function releaseDrone() {
  if (!state.isDrone || !state.audio || !state.droneGain) return;
  const now = state.audio.currentTime;
  state.droneGain.gain.cancelScheduledValues(now);
  state.droneGain.gain.setValueAtTime(Math.max(.0001, state.droneGain.gain.value), now);
  state.droneGain.gain.exponentialRampToValueAtTime(.0001, now + .32);
  state.isDrone = false;
  clearStopBuffer();
  setTimeout(stopDroneNodes, 390);
  updateControls();
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
    clearStopBuffer();
  }
  updateControls();
}

function updateDrone() {
  if (!state.isDrone) return;
  state.droneGain.gain.linearRampToValueAtTime((state.volume / 100) * .18, state.audio.currentTime + .12);
  buildDrone();
}

function microphoneConstraints() {
  const deviceId = state.microphoneId === 'default' ? undefined : { exact: state.microphoneId };
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(deviceId ? { deviceId } : {}) };
}

async function refreshMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput');
    const currentValue = state.microphoneId;
    el.microphone.replaceChildren(new Option('system default', 'default'));
    devices.filter(device => device.deviceId !== 'default').forEach((device, index) => {
      el.microphone.add(new Option(device.label || `microphone ${index + 1}`, device.deviceId));
    });
    const selectedIsAvailable = [...el.microphone.options].some(option => option.value === currentValue);
    if (!selectedIsAvailable) state.microphoneId = 'default';
    el.microphone.value = state.microphoneId;
  } catch {}
}

async function connectMicrophone() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints() });
  setupAudio();
  if (!state.analyser) {
    state.analyser = state.audio.createAnalyser();
    state.analyser.fftSize = 2048;
    state.analyser.smoothingTimeConstant = .2;
  }
  state.micSource?.disconnect();
  state.micStream?.getTracks().forEach(track => track.stop());
  state.micSource = state.audio.createMediaStreamSource(stream);
  state.micSource.connect(state.analyser);
  state.micStream = stream;
  state.isListening = true;
  await refreshMicrophones();
}

async function startListening() {
  if (state.isListening) return stopListening();
  try {
    await connectMicrophone();
    updateControls();
  } catch (error) {
    el.lessonText.textContent = 'That microphone was not available. Choose another input or check browser permission.';
    el.pitchDetail.textContent = 'microphone permission needed';
  }
}

async function selectMicrophone() {
  state.microphoneId = el.microphone.value;
  localStorage.setItem('tonal-field-microphone', state.microphoneId);
  if (!state.isListening) {
    el.pitchDetail.textContent = state.microphoneId === 'default' ? 'system microphone selected' : 'microphone selected · enable listening';
    return;
  }
  try {
    await connectMicrophone();
    el.pitchDetail.textContent = 'microphone switched';
    updateControls();
  } catch (error) {
    el.pitchDetail.textContent = 'could not switch microphone';
  }
}

function stopListening() {
  state.micSource?.disconnect();
  state.micStream?.getTracks().forEach(track => track.stop());
  state.micSource = null; state.micStream = null; state.analyser = null; state.isListening = false; state.detected = null;
  updateControls();
}

async function cueDrone() {
  setupAudio();
  if (state.audio.state !== 'running') state.audio.resume().catch(() => {});
  const now = state.audio.currentTime;
  const targetLevel = (state.volume / 100) * .18;
  if (!state.isDrone) {
    clearStopBuffer();
    state.isDrone = true;
    buildDrone();
    state.droneGain.gain.cancelScheduledValues(now);
    state.droneGain.gain.setValueAtTime(.0001, now);
    state.droneGain.gain.exponentialRampToValueAtTime(Math.max(.0002, targetLevel * .62), now + .055);
    state.droneGain.gain.exponentialRampToValueAtTime(Math.max(.0002, targetLevel), now + .22);
  } else {
    state.droneGain.gain.cancelScheduledValues(now);
    state.droneGain.gain.setValueAtTime(Math.max(.0001, state.droneGain.gain.value), now);
    state.droneGain.gain.linearRampToValueAtTime(Math.max(.0001, targetLevel * .82), now + .03);
    state.droneGain.gain.exponentialRampToValueAtTime(Math.max(.0002, targetLevel), now + .16);
  }
  updateControls();
}

async function enterCamera() {
  if (state.isCamera) return;
  try {
    setupAudio();
    if (state.audio.state !== 'running') state.audio.resume().catch(() => {});
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
  state.cueRecording = null;
  document.body.classList.remove('is-recording');
  clearMotionBuffer();
  clearStopBuffer();
  resetCueGate();
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
  const fingerTips = [8, 12, 16, 20].map(index => landmarks[index]);
  const fingerTotal = averagePoint(fingerTips);
  const fingerCenter = { x: fingerTotal.x / fingerTips.length, y: fingerTotal.y / fingerTips.length, z: fingerTotal.z / fingerTips.length };
  const width = Math.max(pointDistance(landmarks[5], landmarks[17]), .001);
  const ratios = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, pip]) => pointDistance(landmarks[tip], landmarks[0]) / Math.max(pointDistance(landmarks[pip], landmarks[0]), .001));
  const a = { x: landmarks[5].x - landmarks[0].x, y: landmarks[5].y - landmarks[0].y, z: landmarks[5].z - landmarks[0].z };
  const b = { x: landmarks[17].x - landmarks[0].x, y: landmarks[17].y - landmarks[0].y, z: landmarks[17].z - landmarks[0].z };
  const normal = normalize({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  return { center, fingerCenter, width, ratios, normal };
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
    fingerCenter: blendPoint(from.fingerCenter, to.fingerCenter),
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
  const color = mode === 'calibrate' ? '196, 215, 162' : mode === 'record' || mode === 'arm' ? '232, 202, 123' : state.isCueMode ? '232, 202, 123' : '235, 163, 179';
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
  const countdown = mode === 'arm' ? (progress >= 1 ? '✓' : '·') : Math.max(1, 3 - Math.floor(progress * 3));
  gestureCtx.fillStyle = 'rgba(255, 249, 238, .96)';
  gestureCtx.font = '500 22px Inter, system-ui, sans-serif';
  gestureCtx.textAlign = 'center';
  gestureCtx.textBaseline = 'middle';
  gestureCtx.fillText(String(countdown), x, y - 5);
  gestureCtx.fillStyle = `rgba(${color}, .88)`;
  gestureCtx.font = '500 9px Inter, system-ui, sans-serif';
  gestureCtx.fillText(mode === 'calibrate' ? 'SAVE CUE' : mode === 'record' ? 'RECORD CUE' : mode === 'arm' ? (progress >= 1 ? 'ARMED' : 'ARMING') : state.isCueMode ? 'EXIT CUE MODE' : 'ENTER CUE MODE', x, y + 17);
}

function updateGestureState(text) {
  el.gestureState.textContent = text;
}

function clearMotionBuffer() {
  state.motionBuffer = [];
}

function resetCueGate() {
  state.cueGate = null;
}

function mirroredPoint(pose, at = performance.now()) {
  return { x: 1 - pose.center.x, y: pose.center.y, at };
}

function isReadyHandSteady(pose, reference) {
  return pointDistance(pose.center, reference.center) < .022 && dot(pose.normal, reference.normal) > .42;
}

function beginsCueMotion(pose, reference) {
  return pointDistance(pose.center, reference.center) > Math.max(CUE_START_DISTANCE, pose.width * .42);
}

function advanceCueGate(pose, copy) {
  const now = performance.now();
  if (isClosedFist(pose)) {
    resetCueGate();
    updateGestureState(copy.open || 'open your hand to arm');
    clearGestureCanvas();
    return null;
  }
  if (!state.cueGate) {
    state.cueGate = { phase: 'settling', pose, startedAt: now };
    updateGestureState(copy.settle);
    drawGestureCue(pose, 0, 'arm');
    return null;
  }
  const gate = state.cueGate;
  if (gate.phase === 'settling') {
    if (!isReadyHandSteady(pose, gate.pose)) {
      gate.pose = pose;
      gate.startedAt = now;
      updateGestureState(copy.settle);
      drawGestureCue(pose, 0, 'arm');
      return null;
    }
    const progress = Math.min(1, (now - gate.startedAt) / CUE_ARM_MS);
    drawGestureCue(pose, progress, 'arm');
    updateGestureState(progress >= 1 ? copy.armed : copy.settle);
    if (progress >= 1) {
      gate.phase = 'armed';
      gate.armedPose = pose;
    }
    return null;
  }
  if (!beginsCueMotion(pose, gate.armedPose)) {
    drawGestureCue(pose, 1, 'arm');
    updateGestureState(copy.armed);
    return null;
  }
  const start = mirroredPoint(gate.armedPose, now - 50);
  const end = mirroredPoint(pose, now);
  resetCueGate();
  return [start, end];
}

function recordMotionPoint(pose) {
  const now = performance.now();
  state.motionBuffer.push(mirroredPoint(pose, now));
  state.motionBuffer = state.motionBuffer.filter(point => now - point.at < 2200);
}

function loopMetrics(points) {
  if (points.length < 12) return null;
  const first = points[0];
  const last = points.at(-1);
  const duration = last.at - first.at;
  const bounds = points.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x), maxX: Math.max(result.maxX, point.x),
    minY: Math.min(result.minY, point.y), maxY: Math.max(result.maxY, point.y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const center = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  center.x /= points.length;
  center.y /= points.length;
  let pathLength = 0;
  let winding = 0;
  let previousAngle = Math.atan2(points[0].y - center.y, points[0].x - center.x);
  for (let index = 1; index < points.length; index++) {
    pathLength += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    const angle = Math.atan2(points[index].y - center.y, points[index].x - center.x);
    let delta = angle - previousAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    winding += delta;
    previousAngle = angle;
  }
  const head = points.slice(0, Math.min(4, points.length));
  const tail = points.slice(-Math.min(4, points.length));
  const startGrip = head.reduce((total, point) => total + point.grip, 0) / head.length;
  const endGrip = tail.reduce((total, point) => total + point.grip, 0) / tail.length;
  return { duration, width, height, pathLength, winding: Math.abs(winding), returnDistance: Math.hypot(last.x - first.x, last.y - first.y), startGrip, endGrip, gripGain: endGrip - startGrip };
}

function handGrip(pose) {
  return pose.ratios.reduce((total, ratio) => total + Math.max(0, Math.min(1, (1.48 - ratio) / .5)), 0) / pose.ratios.length;
}

function evaluateReleaseLoop(pose) {
  if (!state.isCueMode || !state.isDrone || state.isCalibrating || state.cueRecording || performance.now() < state.stopCooldownUntil) return false;
  const now = performance.now();
  state.stopBuffer.push({ ...mirroredPoint(pose, now), grip: handGrip(pose) });
  state.stopBuffer = state.stopBuffer.filter(point => now - point.at < 1300);
  const metrics = loopMetrics(state.stopBuffer);
  if (!metrics) return false;
  const closesIntoRelease = metrics.startGrip < .48 && metrics.endGrip > .62 && metrics.gripGain > .25;
  const curvedMotion = metrics.width > .045 && metrics.height > .045 && metrics.pathLength > .18 && metrics.winding > 1.55;
  const returningStroke = metrics.pathLength > .28 && metrics.returnDistance < .18;
  const isReleaseGesture = metrics.duration > 280 && metrics.duration < 1250 && closesIntoRelease && (curvedMotion || returningStroke);
  if (!isReleaseGesture) return false;
  state.stopCooldownUntil = now + 1200;
  clearMotionBuffer();
  resetCueGate();
  clearGestureCanvas();
  updateGestureState('release received · field settles');
  releaseDrone();
  return true;
}

function drawMotionTrail() {
  resizeGestureCanvas();
  clearGestureCanvas();
  if (state.motionBuffer.length < 2) return;
  gestureCtx.beginPath();
  state.motionBuffer.forEach((point, index) => {
    const x = point.x * window.innerWidth;
    const y = point.y * window.innerHeight;
    if (index === 0) gestureCtx.moveTo(x, y); else gestureCtx.lineTo(x, y);
  });
  gestureCtx.strokeStyle = state.cueTemplates.length ? 'rgba(255, 210, 130, .9)' : 'rgba(223, 157, 177, .74)';
  gestureCtx.lineWidth = 3;
  gestureCtx.lineCap = 'round';
  gestureCtx.lineJoin = 'round';
  gestureCtx.shadowBlur = 13;
  gestureCtx.shadowColor = state.cueTemplates.length ? 'rgb(255, 205, 118)' : 'rgb(225, 143, 174)';
  gestureCtx.stroke();
  gestureCtx.shadowBlur = 0;
  const latest = state.motionBuffer.at(-1);
  gestureCtx.beginPath();
  gestureCtx.arc(latest.x * window.innerWidth, latest.y * window.innerHeight, 5, 0, Math.PI * 2);
  gestureCtx.fillStyle = state.cueTemplates.length ? 'rgba(255, 224, 165, 1)' : 'rgba(246, 204, 217, 1)';
  gestureCtx.fill();
}

function resampleTrajectory(points, count = 28) {
  if (points.length < 2) return null;
  const distances = [0];
  for (let index = 1; index < points.length; index++) {
    distances.push(distances[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  const total = distances.at(-1);
  if (total < .045) return null;
  return Array.from({ length: count }, (_, index) => {
    const target = total * index / (count - 1);
    let segment = 1;
    while (segment < distances.length - 1 && distances[segment] < target) segment++;
    const previousDistance = distances[segment - 1];
    const segmentLength = Math.max(.00001, distances[segment] - previousDistance);
    const amount = (target - previousDistance) / segmentLength;
    const start = points[segment - 1];
    const end = points[segment];
    return { x: start.x + (end.x - start.x) * amount, y: start.y + (end.y - start.y) * amount };
  });
}

function normalizeTrajectory(points) {
  const origin = points[0];
  const extent = Math.max(.04, ...points.map(point => Math.max(Math.abs(point.x - origin.x), Math.abs(point.y - origin.y))));
  return points.map(point => ({ x: (point.x - origin.x) / extent, y: (point.y - origin.y) / extent }));
}

function makeCueTemplate(points) {
  const sampled = resampleTrajectory(points);
  if (!sampled) return null;
  return { points: normalizeTrajectory(sampled), duration: points.at(-1).at - points[0].at };
}

function cueTemplateScore(template, points) {
  const sampled = resampleTrajectory(points, template.points.length);
  if (!sampled) return Infinity;
  const normalized = normalizeTrajectory(sampled);
  return normalized.reduce((total, point, index) => total + Math.hypot(point.x - template.points[index].x, point.y - template.points[index].y), 0) / normalized.length;
}

function cuePrompt() {
  return state.cueTemplates.length >= 3 ? 'settle to arm · circle to release · fist exits mode' : 'record 3 cue motions in tune · fist exits mode';
}

function updateCueRecordButton() {
  const count = state.cueTemplates.length;
  el.recordCueMotion.textContent = count >= 3 ? 're-record cue motions' : `record cue motion · ${count}/3`;
}

function saveCueTemplate(points) {
  const template = makeCueTemplate(points);
  if (!template) return false;
  state.cueTemplates.push(template);
  localStorage.setItem('tonal-field-cue-motion', JSON.stringify(state.cueTemplates));
  updateCueRecordButton();
  return true;
}

async function beginCueMotionRecording({ restart = false } = {}) {
  if (!state.isCamera) await enterCamera();
  if (!state.isCamera) return;
  if (!state.isCueMode) {
    state.isCueMode = true;
    state.activeCueHandLabel = state.currentHandLabel;
    state.gestureAwaitRelease = false;
    updateControls();
  }
  if (restart || state.cueTemplates.length >= 3) {
    state.cueTemplates = [];
    localStorage.removeItem('tonal-field-cue-motion');
    updateCueRecordButton();
  }
  state.cueRecording = { phase: 'waiting', startedAt: null, points: [] };
  document.body.classList.add('is-recording');
  state.gestureHold = null;
  state.gestureAwaitRelease = false;
  clearMotionBuffer();
  resetCueGate();
  setControlsCollapsed(true);
  updateGestureState(`cue sample ${state.cueTemplates.length + 1}/3 · show your right hand`);
}

function captureCueMotion(pose) {
  const recording = state.cueRecording;
  if (!recording) return false;
  const now = performance.now();
  if (recording.phase === 'waiting') {
    recording.phase = 'countdown';
    recording.startedAt = now;
    updateGestureState(`cue sample ${state.cueTemplates.length + 1}/3 · get ready`);
    return true;
  }
  if (recording.phase === 'countdown') {
    const progress = Math.min(1, (now - recording.startedAt) / 1800);
    drawGestureCue(pose, progress, 'record');
    updateGestureState(`cue sample ${state.cueTemplates.length + 1}/3 · ${Math.max(1, 2 - Math.floor(progress * 2))}`);
    if (progress >= 1) {
      recording.phase = 'ready';
      recording.startedAt = null;
      recording.points = [];
      clearMotionBuffer();
      resetCueGate();
      updateGestureState('settle your open hand to arm');
    }
    return true;
  }
  if (recording.phase === 'interlude') {
    if (now - recording.startedAt < 800) return true;
    recording.phase = 'waiting';
    recording.startedAt = null;
    updateGestureState(`cue sample ${state.cueTemplates.length + 1}/3 · show your right hand`);
    return true;
  }
  if (recording.phase === 'ready') {
    const opening = advanceCueGate(pose, { open: 'open your hand to begin', settle: 'settle your open hand to arm', armed: 'armed · conduct the cue' });
    if (!opening) return true;
    recording.phase = 'capture';
    recording.startedAt = now;
    recording.points = opening;
    state.motionBuffer = recording.points;
    updateGestureState('recording your cue');
    drawMotionTrail();
    return true;
  }
  const point = mirroredPoint(pose, now);
  recording.points.push(point);
  state.motionBuffer = recording.points;
  drawMotionTrail();
  if (now - recording.startedAt >= CUE_CAPTURE_MS) {
    const saved = saveCueTemplate(recording.points);
    clearMotionBuffer();
    if (!saved) {
      state.cueRecording = { phase: 'waiting', startedAt: null, points: [] };
      resetCueGate();
      updateGestureState('not enough motion · try this sample again');
      return true;
    }
    if (state.cueTemplates.length < 3) {
      recording.phase = 'interlude';
      recording.startedAt = now;
      recording.points = [];
      resetCueGate();
      updateGestureState(`sample saved · preparing ${state.cueTemplates.length + 1}/3`);
      return true;
    }
    state.cueRecording = null;
    document.body.classList.remove('is-recording');
    resetCueGate();
    updateGestureState('cue vocabulary saved · try it');
  }
  return true;
}

async function evaluateCueMotion(pose) {
  if (!state.isCueMode || state.isCalibrating || state.gestureAwaitRelease) return;
  if (captureCueMotion(pose)) return;
  if (state.cueTemplates.length < 3) {
    updateGestureState(cuePrompt());
    return;
  }
  const now = performance.now();
  if (now < state.cueCooldownUntil) return;
  if (!state.motionBuffer.length) {
    const opening = advanceCueGate(pose, { open: 'open your hand to begin', settle: 'settle your open hand to arm', armed: 'armed · begin your cue' });
    if (!opening) return;
    state.motionBuffer = opening;
    updateGestureState('cue in motion');
  } else {
    recordMotionPoint(pose);
  }
  const latest = state.motionBuffer.at(-1);
  const maximumDuration = Math.max(...state.cueTemplates.map(template => template.duration)) * 1.48;
  if (latest.at - state.motionBuffer[0].at > maximumDuration) {
    clearMotionBuffer();
    resetCueGate();
    updateGestureState('cue reset · settle your hand to arm');
    return;
  }
  const bestScore = Math.min(...state.cueTemplates.map(template => {
    const points = state.motionBuffer.filter(point => latest.at - point.at <= template.duration * 1.25);
    const duration = points.at(-1).at - points[0].at;
    if (points.length < 8 || duration < template.duration * .64 || duration > template.duration * 1.48) return Infinity;
    return cueTemplateScore(template, points);
  }));
  if (bestScore < CUE_MATCH_THRESHOLD) {
    state.cueCooldownUntil = now + 1600;
    clearMotionBuffer();
    updateGestureState('cue received · drone blooms');
    await cueDrone();
    return;
  }
  updateGestureState('follow your recorded cue · fist to exit');
  drawMotionTrail();
}

function resetGestureHold() {
  state.gestureHold = null;
  clearGestureCanvas();
  if (state.isCamera && !state.isCalibrating && !state.cueRecording) updateGestureState(state.isCueMode ? cuePrompt() : 'hold a fist to cue');
}

function saveCalibration(pose) {
  state.gestureCalibration = { ratios: pose.ratios, normal: pose.normal };
  localStorage.setItem('tonal-field-cue', JSON.stringify(state.gestureCalibration));
  state.isCalibrating = false;
  state.gestureAwaitRelease = true;
  state.cueRecording = null;
  document.body.classList.remove('is-recording');
  clearStopBuffer();
  resetCueGate();
  resetGestureHold();
  updateGestureState('cue saved · release your hand');
}

function toggleCueMode() {
  const enteringCueMode = !state.isCueMode;
  state.isCueMode = enteringCueMode;
  state.activeCueHandLabel = enteringCueMode ? state.currentHandLabel : null;
  state.gestureAwaitRelease = true;
  state.cueRecording = null;
  state.autoTeachOnRelease = enteringCueMode && state.cueTemplates.length < 3;
  document.body.classList.remove('is-recording');
  clearMotionBuffer();
  clearStopBuffer();
  resetCueGate();
  resetGestureHold();
  updateControls();
  updateGestureState(state.isCueMode ? 'cue mode · release your hand' : 'cue mode released · release your hand');
}

function evaluateGesture(pose) {
  const mode = state.isCalibrating ? 'calibrate' : 'cue';
  const candidate = isClosedFist(pose) && (state.isCalibrating || matchesCalibration(pose));
  if (!candidate) {
    const shouldStartAutoTeach = state.gestureAwaitRelease && state.autoTeachOnRelease && state.isCueMode;
    if (state.gestureAwaitRelease) state.gestureAwaitRelease = false;
    resetGestureHold();
    if (shouldStartAutoTeach) {
      state.autoTeachOnRelease = false;
      beginCueMotionRecording();
    }
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
  const allHands = results.multiHandLandmarks || [];
  const handLabels = results.multiHandedness || [];
  let activeIndex = 0;
  if (state.isCueMode && state.activeCueHandLabel) {
    const matchedIndex = handLabels.findIndex(handedness => handedness.label === state.activeCueHandLabel);
    if (matchedIndex >= 0) activeIndex = matchedIndex;
  }
  const landmarks = allHands[activeIndex];
  if (!landmarks) {
    const shouldStartAutoTeach = state.gestureAwaitRelease && state.autoTeachOnRelease && state.isCueMode;
    if (state.gestureAwaitRelease) state.gestureAwaitRelease = false;
    let recordingInterrupted = false;
    if (state.cueRecording) {
      if (state.cueRecording.phase === 'waiting' || state.cueRecording.phase === 'interlude') {
        updateGestureState(`cue sample ${state.cueTemplates.length + 1}/3 · show your right hand`);
        return;
      }
      state.cueRecording.missingSince ||= performance.now();
      if (performance.now() - state.cueRecording.missingSince < 500) return;
      state.cueRecording = null;
      document.body.classList.remove('is-recording');
      resetCueGate();
      recordingInterrupted = true;
    }
    state.smoothedPose = null;
    clearMotionBuffer();
    resetGestureHold();
    if (recordingInterrupted) updateGestureState('recording paused · show your hand and try again');
    if (shouldStartAutoTeach) {
      state.autoTeachOnRelease = false;
      beginCueMotionRecording();
    }
    return;
  }
  state.currentHandLabel = handLabels[activeIndex]?.label || null;
  const pose = smoothPose(handPose(landmarks));
  if (state.cueRecording) {
    state.cueRecording.missingSince = null;
    captureCueMotion(pose);
    return;
  }
  const isFist = isClosedFist(pose) && (state.isCalibrating || matchesCalibration(pose));
  if (evaluateReleaseLoop(pose)) return;
  evaluateGesture(pose);
  if (!isFist) evaluateCueMotion(pose);
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
  updateGestureState(state.isCueMode ? cuePrompt() : 'hold a fist to cue');
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
el.microphone.addEventListener('change', selectMicrophone);
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
el.recordCueMotion.addEventListener('click', beginCueMotionRecording);
window.addEventListener('resize', clearGestureCanvas);

updateDescriptors(0); updateCueRecordButton(); updateControls(); requestAnimationFrame(draw);
refreshMicrophones();
navigator.mediaDevices?.addEventListener?.('devicechange', refreshMicrophones);
setInterval(() => { readPitch(); updateLiveCopy(); }, 70);
