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

const gestureTestParams = new URLSearchParams(window.location.search);
const gestureTest = {
  enabled: gestureTestParams.has('gestureFixture'),
  fixture: gestureTestParams.get('gestureFixture'),
  runId: gestureTestParams.get('gestureRun') || 'manual',
  warmingUp: false,
  warmupResolve: null,
  processedFrames: 0,
  handFrames: 0,
  lastFrameTime: -1,
  lastReportedState: null
};

const el = {
  canvas: document.getElementById('field'), orb: document.getElementById('orb-button'), orbCopy: document.getElementById('orb-copy'),
  fifthsOverlay: document.getElementById('fifths-overlay'),
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
  recordCueMotion: document.getElementById('record-cue-motion'), microphone: document.getElementById('microphone-select'),
  volumeHud: document.getElementById('volume-hud'), volumeHudValue: document.getElementById('volume-hud-value'),
  volumeHudMeter: document.getElementById('volume-hud-meter')
};

noteNames.forEach((name, index) => {
  const option = new Option(name, index === 0 ? '0' : String(index));
  el.key.add(option);
});

const state = {
  audio: null, droneGain: null, droneNodes: [], lfoNodes: [], isDrone: false,
  analyser: null, micStream: null, micSource: null,
  microphoneId: localStorage.getItem('mimetry-microphone') || localStorage.getItem('tonal-field-microphone') || 'default',
  cameraStream: null, hands: null, faceMesh: null, faceLandmarks: null, handLoopRunning: false,
  faceTrackingBusy: false, lastFaceTrackingAt: 0,
  isListening: false, isCamera: false, isCueMode: false, isCalibrating: false,
  cueRecording: null, cueGate: null, cuePhase: 'idle', cueAnchor: null,
  cueStartedAt: 0, cueStillSince: 0, autoTeachOnRelease: false,
  volumeMotionBuffer: [], volumeGestureLastY: 0, volumeGestureLastPalmY: 0,
  volumeGestureStartedAt: 0,
  volumeGestureLastMatchAt: 0, volumeGestureLastPulseAt: 0,
  volumeRaiseReady: false, volumeLowerReady: false, volumeLowerPressing: false,
  volumeIntentCandidate: null, volumeIntentSince: 0, volumeIntentLastEvidenceAt: 0,
  volumeFeedbackStep: null, volumeHudTimer: null,
  key: 0, octave: 3, warmth: 54, volume: 48, sensitivity: 56,
  inputProfile: 'voice', detected: null, targetHistory: [],
  gestureHold: null, smoothedPose: null, gestureAwaitRelease: false,
  motionBuffer: [], stopBuffer: [], cueCooldownUntil: 0, stopCooldownUntil: 0,
  stopArcCandidateAt: 0,
  gestureCommandAwaitReset: false, gestureCommandResetPose: null, gestureCommandResetSince: 0,
  gestureCommandMissingSince: 0,
  earGestureStartedAt: 0, earGestureCooldownUntil: 0,
  orbGrabActive: false, orbGrabAngle: 0, orbGrabAccumulatedAngle: 0, orbGrabLastStepAt: 0, orbGrabEnteredAt: 0, orbGrabHasMoved: false,
  currentHandLabel: null, activeCueHandLabel: null, activeCueHandPosition: null,
  cueTemplates: gestureTest.enabled ? [] : JSON.parse(localStorage.getItem('mimetry-cue-motion') || localStorage.getItem('tonal-field-cue-motion') || '[]'),
  gestureCalibration: gestureTest.enabled ? null : JSON.parse(localStorage.getItem('mimetry-cue') || localStorage.getItem('tonal-field-cue') || 'null'),
  selectedDescriptors: new Set(JSON.parse(localStorage.getItem('mimetry-descriptors') || localStorage.getItem('tonal-field-descriptors') || '[]'))
};
const ctx = el.canvas.getContext('2d');
const gestureCtx = el.gestureCanvas.getContext('2d');
let lastDescriptorInterval = null;
const CUE_ARM_MS = 320;
const CUE_CAPTURE_MS = 1100;
const CUE_START_DISTANCE = .048;
const CUE_MATCH_THRESHOLD = .245;
const gestureCommandEvents = new Set(['start', 'raise', 'lower', 'stop']);

function reportGestureTest(kind, detail = {}) {
  if (!gestureTest.enabled || window.parent === window) return;
  window.parent.postMessage({ source: 'mimetry-gesture-test', runId: gestureTest.runId, kind, ...detail }, window.location.origin);
}

function emitGestureEvent(type, detail = {}) {
  const event = { type, at: gestureNow(), ...detail };
  window.dispatchEvent(new CustomEvent('mimetry-gesture', { detail: event }));
  if (gestureCommandEvents.has(type)) reportGestureTest('gesture-event', { event });
}

function noteFrequency(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function selectedMidi() { return 12 * (state.octave + 1) + state.key; }
function midiFromFrequency(frequency) { return 69 + 12 * Math.log2(frequency / 440); }
function centsOff(frequency, midi) { return Math.round(1200 * Math.log2(frequency / noteFrequency(midi))); }
function cleanModulo(value, modulo) { return ((value % modulo) + modulo) % modulo; }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function gestureNow() { return gestureTest.enabled ? el.camera.currentTime * 1000 : performance.now(); }

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
  state.stopArcCandidateAt = 0;
}

function releaseDrone() {
  if (!state.isDrone) return;
  if (gestureTest.enabled) {
    state.isDrone = false;
    state.gestureCommandAwaitReset = false;
    state.gestureCommandResetPose = null;
    if (state.cuePhase === 'volume-up' || state.cuePhase === 'volume-down') state.cuePhase = state.isCueMode ? 'ready' : 'idle';
    resetVolumeMotion();
    clearStopBuffer();
    updateControls();
    return;
  }
  if (!state.audio || !state.droneGain) return;
  const now = state.audio.currentTime;
  state.droneGain.gain.cancelScheduledValues(now);
  state.droneGain.gain.setValueAtTime(Math.max(.0001, state.droneGain.gain.value), now);
  state.droneGain.gain.exponentialRampToValueAtTime(.0001, now + .32);
  state.isDrone = false;
  state.gestureCommandAwaitReset = false;
  state.gestureCommandResetPose = null;
  if (state.cuePhase === 'volume-up' || state.cuePhase === 'volume-down') state.cuePhase = state.isCueMode ? 'ready' : 'idle';
  resetVolumeMotion();
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
    if (state.cuePhase === 'volume-up' || state.cuePhase === 'volume-down') state.cuePhase = state.isCueMode ? 'ready' : 'idle';
    resetVolumeMotion();
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
  localStorage.setItem('mimetry-microphone', state.microphoneId);
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
  if (gestureTest.enabled) {
    const wasDrone = state.isDrone;
    state.isDrone = true;
    clearStopBuffer();
    if (!wasDrone) {
      state.stopCooldownUntil = gestureNow() + 900;
      state.cueCooldownUntil = gestureNow() + 900;
      state.cuePhase = 'cooldown';
      state.gestureCommandAwaitReset = true;
      state.gestureCommandResetPose = null;
      emitGestureEvent('start', { volume: state.volume });
    }
    updateControls();
    return;
  }
  setupAudio();
  if (state.audio.state !== 'running') state.audio.resume().catch(() => {});
  const now = state.audio.currentTime;
  const targetLevel = (state.volume / 100) * .18;
  if (!state.isDrone) {
    clearStopBuffer();
    state.stopCooldownUntil = gestureNow() + 900;
    state.cueCooldownUntil = gestureNow() + 900;
    state.cuePhase = 'cooldown';
    state.gestureCommandAwaitReset = true;
    state.gestureCommandResetPose = null;
    state.isDrone = true;
    buildDrone();
    state.droneGain.gain.cancelScheduledValues(now);
    state.droneGain.gain.setValueAtTime(.0001, now);
    state.droneGain.gain.exponentialRampToValueAtTime(Math.max(.0002, targetLevel * .62), now + .055);
    state.droneGain.gain.exponentialRampToValueAtTime(Math.max(.0002, targetLevel), now + .22);
    emitGestureEvent('start', { volume: state.volume });
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
    el.lessonText.textContent = 'Camera access was not available. You can keep practicing in Mimetry.';
    el.pitchDetail.textContent = 'camera permission needed';
  }
}

async function enterFixtureCamera() {
  if (!gestureTest.enabled || !gestureTest.fixture || state.isCamera) return;
  try {
    const fixtureUrl = new URL(gestureTest.fixture, window.location.href);
    if (fixtureUrl.origin !== window.location.origin) throw new Error('Fixture must be served from the same origin.');
    el.camera.srcObject = null;
    el.camera.src = fixtureUrl.href;
    el.camera.autoplay = false;
    el.camera.muted = true;
    el.camera.loop = false;
    el.camera.playbackRate = 1;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Fixture video did not load.')), 10000);
      el.camera.addEventListener('loadeddata', () => { clearTimeout(timeout); resolve(); }, { once: true });
      el.camera.load();
    });
    el.camera.pause();
    el.camera.currentTime = 0;
    el.camera.addEventListener('ended', () => {
      setTimeout(() => {
        state.handLoopRunning = false;
        reportGestureTest('fixture-ended', {
          duration: el.camera.duration,
          processedFrames: gestureTest.processedFrames,
          handFrames: gestureTest.handFrames
        });
      }, 700);
    }, { once: true });
    state.isCamera = true;
    document.body.classList.add('camera-active', 'gesture-fixture-active');
    setControlsCollapsed(true);
    gestureTest.warmingUp = true;
    const modelReady = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Hand tracker did not initialize.')), 15000);
      gestureTest.warmupResolve = () => { clearTimeout(timeout); resolve(); };
    });
    startHandTracking();
    await modelReady;
    gestureTest.warmingUp = false;
    gestureTest.warmupResolve = null;
    state.smoothedPose = null;
    resetGestureHold();
    await el.camera.play();
    reportGestureTest('fixture-started', { fixture: gestureTest.fixture, duration: el.camera.duration });
  } catch (error) {
    reportGestureTest('fixture-error', { message: error instanceof Error ? error.message : String(error) });
    updateGestureState('fixture could not be played');
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
  state.faceLandmarks = null;
  state.faceTrackingBusy = false;
  state.lastFaceTrackingAt = 0;
  resetEarGesture();
  resetOrbGrab();
  state.gestureAwaitRelease = false;
  state.activeCueHandLabel = null;
  state.activeCueHandPosition = null;
  state.cueRecording = null;
  state.cuePhase = 'idle';
  state.cueAnchor = null;
  resetVolumeMotion();
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
  const spread = ([[8, 12], [12, 16], [16, 20]]
    .reduce((total, [first, second]) => total + pointDistance(landmarks[first], landmarks[second]), 0) / 3) / width;
  const ratios = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, pip]) => pointDistance(landmarks[tip], landmarks[0]) / Math.max(pointDistance(landmarks[pip], landmarks[0]), .001));
  const a = { x: landmarks[5].x - landmarks[0].x, y: landmarks[5].y - landmarks[0].y, z: landmarks[5].z - landmarks[0].z };
  const b = { x: landmarks[17].x - landmarks[0].x, y: landmarks[17].y - landmarks[0].y, z: landmarks[17].z - landmarks[0].z };
  const normal = normalize({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  // Use screen-space coordinates for rotation: the camera is mirrored in the
  // interface, so a positive angle is visually clockwise to the musician.
  const knuckleAngle = Math.atan2(landmarks[17].y - landmarks[5].y, landmarks[5].x - landmarks[17].x);
  return {
    center, fingerCenter, width, spread, ratios, normal,
    indexTip: landmarks[8], indexPip: landmarks[6], thumbTip: landmarks[4],
    knuckleAngle
  };
}

function closestCueHandIndex(allHands, reference) {
  if (!reference) return -1;
  let closestIndex = -1;
  let closestDistance = Infinity;
  allHands.forEach((landmarks, index) => {
    const distance = pointDistance(handPose(landmarks).center, reference);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  // A hand can briefly lose or flip its handedness label as it rotates. Keep
  // following the same physical hand, but do not jump across the frame.
  return closestDistance < .3 ? closestIndex : -1;
}

function isClosedFist(pose) {
  const foldedFingers = pose.ratios.filter(ratio => ratio < 1.12).length;
  return pose.ratios[0] < 1.12 && foldedFingers >= 3;
}

function handExtension(pose) {
  return pose.ratios.reduce((total, ratio) => total + ratio, 0) / pose.ratios.length;
}

function matchesCalibration(pose) {
  if (!state.gestureCalibration) return true;
  const ratioDifference = pose.ratios.reduce((total, ratio, index) => total + Math.abs(ratio - state.gestureCalibration.ratios[index]), 0) / pose.ratios.length;
  return ratioDifference < .22 && dot(pose.normal, state.gestureCalibration.normal) > .45;
}

function isSteady(pose, reference) {
  // Holding a conducting fist should not require keeping it pinned to a
  // pixel. The reference pose is blended forward while the timer runs, so
  // this still rejects a deliberate sweep while tolerating ordinary drift.
  return pointDistance(pose.center, reference.center) < .145 && dot(pose.normal, reference.normal) > .2;
}

function blendPose(from, to, amount) {
  const blendPoint = (a, b) => ({ x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount, z: a.z + (b.z - a.z) * amount });
  return {
    center: blendPoint(from.center, to.center),
    fingerCenter: blendPoint(from.fingerCenter, to.fingerCenter),
    indexTip: blendPoint(from.indexTip, to.indexTip),
    indexPip: blendPoint(from.indexPip, to.indexPip),
    thumbTip: blendPoint(from.thumbTip, to.thumbTip),
    knuckleAngle: from.knuckleAngle + Math.atan2(Math.sin(to.knuckleAngle - from.knuckleAngle), Math.cos(to.knuckleAngle - from.knuckleAngle)) * amount,
    width: from.width + (to.width - from.width) * amount,
    spread: from.spread + (to.spread - from.spread) * amount,
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

function drawEarCue(pose, progress) {
  resizeGestureCanvas();
  clearGestureCanvas();
  const x = (1 - pose.indexTip.x) * window.innerWidth;
  const y = pose.indexTip.y * window.innerHeight;
  const radius = Math.max(32, Math.min(62, pose.width * window.innerWidth * .52));
  gestureCtx.lineCap = 'round';
  gestureCtx.beginPath();
  gestureCtx.arc(x, y, radius, -Math.PI / 2, Math.PI * 1.5);
  gestureCtx.strokeStyle = 'rgba(196, 215, 162, .22)';
  gestureCtx.lineWidth = 3;
  gestureCtx.stroke();
  gestureCtx.beginPath();
  gestureCtx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  gestureCtx.strokeStyle = 'rgba(196, 215, 162, .96)';
  gestureCtx.shadowBlur = 16;
  gestureCtx.shadowColor = 'rgb(196, 215, 162)';
  gestureCtx.stroke();
  gestureCtx.shadowBlur = 0;
  gestureCtx.fillStyle = 'rgba(255, 249, 238, .96)';
  gestureCtx.font = '500 10px Inter, system-ui, sans-serif';
  gestureCtx.textAlign = 'center';
  gestureCtx.textBaseline = 'middle';
  gestureCtx.fillText(progress >= 1 ? 'LISTEN' : 'LISTEN', x, y + 2);
}

function resetEarGesture() {
  state.earGestureStartedAt = 0;
}

function isPointingAtEar(pose) {
  if (!state.faceLandmarks || !pose.indexTip) return false;
  // 234 and 454 sit at the left/right face edge. They are a stable proxy for
  // the ears without requiring a separate pose model.
  const faceEdges = [state.faceLandmarks[234], state.faceLandmarks[454]];
  const ear = faceEdges.reduce((nearest, edge) => pointDistance(pose.indexTip, edge) < pointDistance(pose.indexTip, nearest) ? edge : nearest);
  const faceWidth = Math.max(pointDistance(faceEdges[0], faceEdges[1]), .001);
  const indexExtended = pose.ratios[0] > 1.18;
  const curledCompanions = pose.ratios.slice(1).filter(ratio => ratio < 1.22).length >= 2;
  const uprightIndex = Math.abs(pose.indexTip.x - pose.indexPip.x) < .13;
  const nearEar = pointDistance(pose.indexTip, ear) < Math.max(.16, faceWidth * .54);
  const earHeight = Math.abs(pose.indexTip.y - ear.y) < faceWidth * .72;
  return indexExtended && curledCompanions && uprightIndex && nearEar && earHeight;
}

function evaluateEarListeningGesture(pose) {
  const now = gestureNow();
  const canListenGesture = state.isCueMode && !state.isCalibrating && !state.cueRecording
    && state.cuePhase === 'ready' && now >= state.earGestureCooldownUntil;
  if (!canListenGesture || !isPointingAtEar(pose)) {
    resetEarGesture();
    return false;
  }
  state.earGestureStartedAt ||= now;
  const progress = Math.min(1, (now - state.earGestureStartedAt) / 720);
  drawEarCue(pose, progress);
  updateGestureState(state.isListening ? 'hold at your ear to pause listening' : 'hold at your ear to listen');
  if (progress < 1) return true;
  const wasListening = state.isListening;
  state.earGestureCooldownUntil = now + 1400;
  resetEarGesture();
  clearGestureCanvas();
  startListening().then(() => {
    updateGestureState(state.isListening ? 'listening enabled' : wasListening ? 'listening paused' : 'microphone permission needed');
    updateControls();
  });
  return true;
}

const circleOfFifths = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

function buildFifthsOverlay() {
  el.fifthsOverlay.innerHTML = circleOfFifths.map((key, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / circleOfFifths.length;
    const x = 50 + Math.cos(angle) * 42;
    const y = 50 + Math.sin(angle) * 42;
    return `<span class="fifths-note" data-fifths-key="${key}" style="left:${x}%;top:${y}%">${noteNames[key]}</span>`;
  }).join('');
}

function updateFifthsOverlay() {
  el.fifthsOverlay.querySelectorAll('[data-fifths-key]').forEach(note => {
    note.classList.toggle('active', Number(note.dataset.fifthsKey) === state.key);
  });
}

function resetOrbGrab() {
  state.orbGrabActive = false;
  state.orbGrabAccumulatedAngle = 0;
  state.orbGrabEnteredAt = 0;
  state.orbGrabHasMoved = false;
  document.body.classList.remove('is-grabbing-orb');
}

function orbScreenCenter() {
  const bounds = el.orb.getBoundingClientRect();
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, radius: Math.max(178, bounds.width * 1.52) };
}

function orbPointerPosition(pose) {
  return { x: (1 - pose.indexTip.x) * window.innerWidth, y: pose.indexTip.y * window.innerHeight };
}

function isInsideOrbField(pose) {
  const orb = orbScreenCenter();
  const pointer = orbPointerPosition(pose);
  return Math.hypot(pointer.x - orb.x, pointer.y - orb.y) < orb.radius;
}

function isOrbPointer(pose) {
  // Let the index lead. Other fingers may be open or curled, which makes this
  // work for the loose, looping spiral in the reference movement.
  return Boolean(pose.indexTip) && pose.ratios[0] > 1.08;
}

function setKeyFromFifths(index) {
  state.key = circleOfFifths[cleanModulo(index, circleOfFifths.length)];
  el.key.value = String(state.key);
  updateDrone();
  updateControls();
  el.orb.classList.remove('orb-key-shift');
  requestAnimationFrame(() => el.orb.classList.add('orb-key-shift'));
}

function fifthsIndexAtPointer(pointer, orb) {
  const angle = Math.atan2(pointer.y - orb.y, pointer.x - orb.x);
  return cleanModulo(Math.round((angle + Math.PI / 2) / (Math.PI * 2 / circleOfFifths.length)), circleOfFifths.length);
}

function evaluateOrbGrab(pose) {
  const now = gestureNow();
  const canGrabOrb = state.isCueMode && !state.isCalibrating && !state.cueRecording
    && state.cuePhase === 'ready';
  const grabbing = canGrabOrb && isInsideOrbField(pose) && isOrbPointer(pose);
  if (!grabbing) {
    if (state.orbGrabActive) updateGestureState('orb released · key set');
    resetOrbGrab();
    return false;
  }
  if (!state.orbGrabActive) {
    const orb = orbScreenCenter();
    const pointer = orbPointerPosition(pose);
    state.orbGrabActive = true;
    state.orbGrabAngle = Math.atan2(pointer.y - orb.y, pointer.x - orb.x);
    state.orbGrabAccumulatedAngle = 0;
    state.orbGrabLastStepAt = now;
    state.orbGrabEnteredAt = now;
    state.orbGrabHasMoved = false;
    document.body.classList.add('is-grabbing-orb');
    updateGestureState('orb field · trace around it');
    return true;
  }
  const orb = orbScreenCenter();
  const pointer = orbPointerPosition(pose);
  const angle = Math.atan2(pointer.y - orb.y, pointer.x - orb.x);
  const delta = Math.atan2(Math.sin(angle - state.orbGrabAngle), Math.cos(angle - state.orbGrabAngle));
  state.orbGrabAngle = angle;
  state.orbGrabAccumulatedAngle += delta;
  if (Math.abs(delta) > .028) state.orbGrabHasMoved = true;
  const pointerRadius = Math.hypot(pointer.x - orb.x, pointer.y - orb.y);
  // Touch the core to reveal the wheel, then drag outward through its labels.
  // The inner dead zone prevents an accidental key jump on first contact.
  const isOnFifthsRing = pointerRadius > orb.radius * .46;
  if (isOnFifthsRing && state.orbGrabHasMoved) {
    const fifthsIndex = fifthsIndexAtPointer(pointer, orb);
    const nextKey = circleOfFifths[fifthsIndex];
    if (nextKey !== state.key && now - state.orbGrabLastStepAt > 105) {
      setKeyFromFifths(fifthsIndex);
      state.orbGrabLastStepAt = now;
      updateGestureState(`${noteNames[state.key]} · circle of fifths`);
    }
  }
  return true;
}

buildFifthsOverlay();

function updateGestureState(text) {
  el.gestureState.textContent = text;
  if (gestureTest.enabled) {
    const telemetryState = text.includes('hold steady to enter') ? 'arming cue mode'
      : text.startsWith('cue mode · release') ? 'cue mode entered'
      : text.startsWith('cue received') ? 'start cue recognized'
      : text.startsWith('start received') ? 'awaiting hand clear'
      : text.startsWith('drone sounding') ? 'dynamics ready'
      : text.startsWith('volume raise') || text.startsWith('raising volume') ? 'raise active'
      : text.startsWith('volume lower') || text.startsWith('lowering volume') ? 'lower active'
      : text.startsWith('release received') ? 'stop recognized'
      : null;
    if (telemetryState && telemetryState !== gestureTest.lastReportedState) {
      gestureTest.lastReportedState = telemetryState;
      reportGestureTest('fsm-state', { state: telemetryState, at: gestureNow() });
    }
  }
}

function clearMotionBuffer() {
  state.motionBuffer = [];
}

function resetCueGate() {
  state.cueGate = null;
}

function mirroredPoint(pose, at = gestureNow()) {
  return { x: 1 - pose.center.x, y: pose.center.y, at };
}

function isReadyHandSteady(pose, reference) {
  return pointDistance(pose.center, reference.center) < .035 && dot(pose.normal, reference.normal) > .25;
}

function beginsCueMotion(pose, reference) {
  return pointDistance(pose.center, reference.center) > Math.max(CUE_START_DISTANCE, pose.width * .42);
}

function advanceCueGate(pose, copy) {
  const now = gestureNow();
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
  const now = gestureNow();
  state.motionBuffer.push(mirroredPoint(pose, now));
  state.motionBuffer = state.motionBuffer.filter(point => now - point.at < 2200);
}

function motionPathLength(points) {
  return points.slice(1).reduce((total, point, index) => total + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
}

function beginLiveCueTracking(pose) {
  state.cuePhase = 'ready';
  state.cueAnchor = pose;
  state.cueStartedAt = 0;
  state.cueStillSince = 0;
  clearMotionBuffer();
  clearGestureCanvas();
  updateGestureState('cue mode ready · trace your cue');
}

function beginLiveCueTrace(pose, now) {
  state.cuePhase = 'tracing';
  state.cueStartedAt = now;
  state.motionBuffer = [mirroredPoint(state.cueAnchor, now - 50), mirroredPoint(pose, now)];
  updateGestureState('cue in motion');
  drawMotionTrail();
}

function completeLiveCue(pose, now) {
  state.cuePhase = 'cooldown';
  state.cueAnchor = pose;
  state.cueStillSince = now;
  state.cueCooldownUntil = now + 700;
  updateGestureState('cue received · drone blooms');
}

function setDroneVolume(level) {
  const nextVolume = clamp(level, 0, 100);
  if (Math.abs(nextVolume - state.volume) < .04) return;
  state.volume = nextVolume;
  el.volume.value = String(Math.round(nextVolume));
  updateControls();
  if (state.isDrone && state.audio && state.droneGain) {
    state.droneGain.gain.setTargetAtTime((state.volume / 100) * .18, state.audio.currentTime, .055);
  }
  const feedbackStep = Math.floor(state.volume / 10);
  if (feedbackStep !== state.volumeFeedbackStep) {
    state.volumeFeedbackStep = feedbackStep;
    navigator.vibrate?.(10);
  }
  pulseVolumeHud();
}

function pulseVolumeHud() {
  document.body.classList.add('volume-changing');
  clearTimeout(state.volumeHudTimer);
  state.volumeHudTimer = setTimeout(() => document.body.classList.remove('volume-changing'), 700);
}

function resetVolumeMotion() {
  state.volumeMotionBuffer = [];
  state.volumeRaiseReady = false;
  state.volumeLowerReady = false;
  state.volumeLowerPressing = false;
  state.volumeIntentCandidate = null;
  state.volumeIntentSince = 0;
  state.volumeIntentLastEvidenceAt = 0;
  state.volumeGestureLastPulseAt = 0;
}

function observeVolumeIntent(intent, now) {
  if (state.volumeIntentCandidate !== intent) {
    state.volumeIntentCandidate = intent;
    state.volumeIntentSince = now;
  }
  state.volumeIntentLastEvidenceAt = now;
}

function volumePressY(pose) {
  // A conductor's press often rotates the palm instead of translating every
  // knuckle equally. Let the fingertips contribute to the tracked descent.
  return pose.center.y * .62 + pose.fingerCenter.y * .38;
}

function trackVolumeMotion(pose, now) {
  const point = {
    at: now,
    x: pose.center.x,
    y: pose.center.y,
    pressY: volumePressY(pose),
    extension: handExtension(pose),
    spread: pose.spread
  };
  state.volumeMotionBuffer.push(point);
  state.volumeMotionBuffer = state.volumeMotionBuffer.filter(sample => now - sample.at < 440);
  const referenceAt = age => {
    let reference = state.volumeMotionBuffer[0];
    for (const sample of state.volumeMotionBuffer) {
      if (now - sample.at >= age) reference = sample;
      else break;
    }
    return reference;
  };
  const curlReference = referenceAt(140);
  const shortReference = referenceAt(90);
  const mediumReference = referenceAt(210);
  const xs = state.volumeMotionBuffer.map(sample => sample.x);
  const ys = state.volumeMotionBuffer.map(sample => sample.y);
  return {
    point,
    age: now - state.volumeMotionBuffer[0].at,
    deltaY: point.y - curlReference.y,
    deltaExtension: point.extension - curlReference.extension,
    deltaPalmShort: point.y - shortReference.y,
    deltaPalmMedium: point.y - mediumReference.y,
    deltaPressShort: point.pressY - shortReference.pressY,
    deltaPressMedium: point.pressY - mediumReference.pressY,
    rangeX: Math.max(...xs) - Math.min(...xs),
    rangeY: Math.max(...ys) - Math.min(...ys)
  };
}

function isPressHandOpen(pose) {
  const extendedFingers = pose.ratios.filter(ratio => ratio > 1.1).length;
  return !isClosedFist(pose) && (handExtension(pose) > 1.08 || extendedFingers >= 2);
}

function completeGestureCommandReset() {
  state.gestureCommandAwaitReset = false;
  state.gestureCommandResetPose = null;
  state.gestureCommandResetSince = 0;
  state.gestureCommandMissingSince = 0;
  state.cuePhase = 'ready';
  resetVolumeMotion();
  clearStopBuffer();
  updateGestureState('drone sounding · shape its volume or release');
}

function evaluateGestureCommandReset(pose) {
  if (!state.gestureCommandAwaitReset) return false;
  // Quarantine the complete start stroke, including its visible tail. The
  // recognizer re-arms after the brief hand-clear transition in onHandResults.
  state.gestureCommandResetPose = pose;
  updateGestureState('start received · release your hand');
  return true;
}

function beginVolumeGesture(command, pose, now) {
  state.cuePhase = command;
  state.volumeGestureLastY = volumePressY(pose);
  state.volumeGestureLastPalmY = pose.center.y;
  state.volumeGestureStartedAt = now;
  state.volumeGestureLastMatchAt = now;
  state.volumeGestureLastPulseAt = now;
  state.volumeRaiseReady = handExtension(pose) > 1.18;
  state.volumeLowerReady = false;
  state.volumeLowerPressing = command === 'volume-down';
  state.volumeFeedbackStep = Math.floor(state.volume / 10);
  clearMotionBuffer();
  clearStopBuffer();
  pulseVolumeHud();
  navigator.vibrate?.(18);
  emitGestureEvent(command === 'volume-up' ? 'raise' : 'lower', { volume: state.volume });
  updateGestureState(command === 'volume-up' ? 'volume raise · beckon the sound closer' : 'volume lower · press the sound down');
}

function finishVolumeGesture(pose, now) {
  state.cuePhase = 'cooldown';
  state.cueAnchor = pose;
  state.cueStillSince = now;
  state.cueCooldownUntil = now + 500;
  state.volumeFeedbackStep = null;
  resetVolumeMotion();
  clearStopBuffer();
  updateGestureState(`volume set · ${Math.round(state.volume)}%`);
}

function evaluateVolumeGesture(pose) {
  if (!state.isCueMode || !state.isDrone || state.isCalibrating || state.cueRecording) return false;
  const now = gestureNow();
  if (state.cuePhase === 'cooldown') {
    if (now < state.cueCooldownUntil) return false;
    state.cuePhase = 'ready';
    state.cueAnchor = pose;
    resetVolumeMotion();
    updateGestureState('drone sounding · shape its volume or release');
  }
  const motion = trackVolumeMotion(pose, now);
  const isActive = state.cuePhase === 'volume-up' || state.cuePhase === 'volume-down';

  if (isActive) {
    const activeCommand = state.cuePhase;
    if (activeCommand === 'volume-up') {
      if (motion.point.extension > 1.18) state.volumeRaiseReady = true;
      const curlPulse = state.volumeRaiseReady && motion.deltaExtension < -.03 && motion.rangeX < .075 && motion.rangeY < .095;
      if (curlPulse && now - state.volumeGestureLastPulseAt > 210) {
        setDroneVolume(state.volume + clamp(-motion.deltaExtension * 48, 2.5, 7));
        state.volumeGestureLastPulseAt = now;
        state.volumeGestureLastMatchAt = now;
        state.volumeRaiseReady = false;
      }
    } else {
      const openHand = isPressHandOpen(pose);
      const downwardDelta = motion.point.pressY - state.volumeGestureLastY;
      const palmDownwardDelta = motion.point.y - state.volumeGestureLastPalmY;
      const resetting = openHand && motion.age >= 90 && motion.deltaPalmShort < -.004;
      const descending = openHand && motion.age >= 90
        && motion.deltaExtension > -.02
        && (motion.deltaPalmShort > .006 || motion.deltaPalmMedium > .012);

      if (resetting) {
        state.volumeLowerReady = true;
        state.volumeLowerPressing = false;
        state.volumeGestureLastMatchAt = now;
      } else if (!state.volumeLowerPressing && state.volumeLowerReady && descending) {
        state.volumeLowerPressing = true;
      }

      if (state.volumeLowerPressing && palmDownwardDelta > .00035 && motion.deltaPalmShort > .0025) {
        setDroneVolume(state.volume - Math.max(downwardDelta, palmDownwardDelta) * 155);
        state.volumeGestureLastMatchAt = now;
      }

      // Reaching the bottom completes one press. A visible upward reset arms
      // the next one, preventing stationary tracking jitter from draining it.
      if (state.volumeLowerPressing && motion.age >= 90 && motion.deltaPalmShort < .001) {
        state.volumeLowerPressing = false;
        state.volumeLowerReady = false;
      }
    }
    state.volumeGestureLastY = motion.point.pressY;
    state.volumeGestureLastPalmY = motion.point.y;
    updateGestureState(activeCommand === 'volume-up'
      ? `raising volume · ${Math.round(state.volume)}%`
      : `lowering volume · ${Math.round(state.volume)}%`);

    if (now - state.volumeGestureLastMatchAt > 760 || now - state.volumeGestureStartedAt > 4200) {
      finishVolumeGesture(pose, now);
    }
    return true;
  }

  const openPressHand = isPressHandOpen(pose);
  if (openPressHand && motion.age >= 100 && motion.deltaPalmShort <= .003) {
    state.volumeLowerReady = true;
  }
  // Volume up is a beckoning curl: the fingers contract while the palm stays
  // relatively planted. Volume down is a true palm translation. The neutral
  // extension band prevents a subtle curl from being stolen by the press cue.
  const raiseMotion = motion.deltaExtension < -.04
    && motion.rangeX < .075 && motion.rangeY < .1 && motion.point.spread < .48;
  // A press is translation of an open hand over a meaningful window. The
  // medium-window requirement is the discriminator: a beckoning hand often
  // relaxes a few pixels downward after its curl, but it has not actually
  // pressed the sound down.
  const lowerMotion = state.volumeLowerReady && openPressHand && motion.age >= 170
    && motion.point.extension > 1.2
    && motion.deltaExtension > -.035
    && motion.deltaPalmMedium > .022
    && motion.rangeY > .025;

  if (raiseMotion) observeVolumeIntent('volume-up', now);
  else if (lowerMotion) observeVolumeIntent('volume-down', now);
  else if (state.volumeIntentCandidate && now - state.volumeIntentLastEvidenceAt > 150) {
    state.volumeIntentCandidate = null;
    state.volumeIntentSince = 0;
  }

  const confirmedRaise = state.volumeIntentCandidate === 'volume-up'
    && now - state.volumeIntentSince >= 45;
  const confirmedLower = state.volumeIntentCandidate === 'volume-down'
    && now - state.volumeIntentSince >= 75;
  if (confirmedRaise) {
    beginVolumeGesture('volume-up', pose, now);
    setDroneVolume(state.volume + clamp(-motion.deltaExtension * 46, 2.5, 7));
    state.volumeRaiseReady = false;
    return true;
  }
  if (confirmedLower) {
    beginVolumeGesture('volume-down', pose, now);
    const pressDistance = Math.max(motion.deltaPalmShort, motion.deltaPalmMedium);
    setDroneVolume(state.volume - clamp(pressDistance * 115, 2.5, 6));
    return true;
  }
  return false;
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
  let angularTravel = 0;
  let previousAngle = Math.atan2(points[0].y - center.y, points[0].x - center.x);
  for (let index = 1; index < points.length; index++) {
    pathLength += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    const angle = Math.atan2(points[index].y - center.y, points[index].x - center.x);
    let delta = angle - previousAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    winding += delta;
    angularTravel += Math.abs(delta);
    previousAngle = angle;
  }
  const head = points.slice(0, Math.min(4, points.length));
  const tail = points.slice(-Math.min(4, points.length));
  const startGrip = head.reduce((total, point) => total + point.grip, 0) / head.length;
  const endGrip = tail.reduce((total, point) => total + point.grip, 0) / tail.length;
  const endsInFist = tail.some(point => point.isFist);
  const minGrip = Math.min(...points.map(point => point.grip));
  const netWinding = Math.abs(winding);
  return {
    duration, width, height, pathLength, winding: netWinding, angularTravel,
    turnConsistency: netWinding / Math.max(angularTravel, .001),
    returnDistance: Math.hypot(last.x - first.x, last.y - first.y),
    startGrip, endGrip, minGrip, gripRange: endGrip - minGrip,
    gripGain: endGrip - startGrip, endsInFist
  };
}

function handGrip(pose) {
  return pose.ratios.reduce((total, ratio) => total + Math.max(0, Math.min(1, (1.48 - ratio) / .5)), 0) / pose.ratios.length;
}

function evaluateReleaseLoop(pose) {
  if (!state.isCueMode || !state.isDrone || state.isCalibrating || state.cueRecording || gestureNow() < state.stopCooldownUntil) return false;
  const now = gestureNow();
  state.stopBuffer.push({ ...mirroredPoint(pose, now), grip: handGrip(pose), isFist: isClosedFist(pose) });
  // Release circles sometimes blur at the fastest part of the stroke. Keep a
  // longer semantic window so the returning fist can reconnect the path.
  state.stopBuffer = state.stopBuffer.filter(point => now - point.at < 2800);
  const metrics = loopMetrics(state.stopBuffer);
  if (!metrics) return false;
  const closesIntoRelease = (metrics.startGrip < .68 && (metrics.endsInFist || (metrics.endGrip > .52 && metrics.gripGain > .16)))
    || (metrics.endsInFist && metrics.minGrip < .62 && metrics.gripRange > .22);
  const aspectRatio = Math.min(metrics.width, metrics.height) / Math.max(metrics.width, metrics.height, .001);
  const movingStroke = metrics.width > .052 && metrics.height > .052 && metrics.pathLength > .22;
  const curvedMotion = metrics.winding > 3.8 && metrics.turnConsistency > .58 && aspectRatio > .4;
  const returningStroke = metrics.returnDistance < Math.max(.1, Math.max(metrics.width, metrics.height) * .82);
  const releaseArc = metrics.duration > 420 && metrics.duration < 1250
    && metrics.width > .09 && metrics.height > .15 && metrics.pathLength > .45
    && metrics.winding > 3.35 && metrics.turnConsistency > .78 && aspectRatio > .32;
  if (releaseArc) {
    state.stopArcCandidateAt = now;
    updateGestureState('release arc received · close your hand');
  }
  const arcClosesIntoFist = state.stopArcCandidateAt
    && now - state.stopArcCandidateAt < 2300
    && isClosedFist(pose);
  if (state.stopArcCandidateAt && now - state.stopArcCandidateAt >= 2300) state.stopArcCandidateAt = 0;
  const isReleaseGesture = metrics.duration > 420 && metrics.duration < 2700
    && closesIntoRelease && movingStroke && curvedMotion && returningStroke;
  if (!isReleaseGesture && !arcClosesIntoFist) return false;
  state.stopCooldownUntil = now + 1200;
  clearMotionBuffer();
  resetCueGate();
  clearGestureCanvas();
  updateGestureState('release received · field settles');
  emitGestureEvent('stop', { volume: state.volume });
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
  return state.cueTemplates.length >= 3
    ? 'cue mode ready · trace your cue · point to your ear to listen'
    : 'cue mode ready · trace your cue · point to your ear to listen';
}

function updateCueRecordButton() {
  const count = state.cueTemplates.length;
  el.recordCueMotion.textContent = count >= 3 ? 're-record cue motions' : `record cue motion · ${count}/3`;
}

function saveCueTemplate(points) {
  const template = makeCueTemplate(points);
  if (!template) return false;
  state.cueTemplates.push(template);
  localStorage.setItem('mimetry-cue-motion', JSON.stringify(state.cueTemplates));
  updateCueRecordButton();
  return true;
}

async function beginCueMotionRecording({ restart = false } = {}) {
  if (!state.isCamera) await enterCamera();
  if (!state.isCamera) return;
  if (!state.isCueMode) {
    state.isCueMode = true;
    state.activeCueHandLabel = state.currentHandLabel;
    state.activeCueHandPosition = state.smoothedPose?.center || null;
    state.gestureAwaitRelease = false;
    updateControls();
  }
  if (restart || state.cueTemplates.length >= 3) {
    state.cueTemplates = [];
    localStorage.removeItem('mimetry-cue-motion');
    updateCueRecordButton();
  }
  state.cueRecording = { phase: 'waiting', startedAt: null, points: [] };
  state.cuePhase = 'recording';
  document.body.classList.add('is-recording');
  state.gestureHold = null;
  state.gestureAwaitRelease = false;
  clearMotionBuffer();
  resetCueGate();
  setControlsCollapsed(true);
  updateGestureState(`cue sample ${state.cueTemplates.length + 1}/3 · show your cue hand`);
}

function captureCueMotion(pose) {
  const recording = state.cueRecording;
  if (!recording) return false;
  const now = gestureNow();
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
    updateGestureState(`cue sample ${state.cueTemplates.length + 1}/3 · show your cue hand`);
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
    state.cuePhase = 'ready';
    state.cueAnchor = pose;
    updateGestureState('cue vocabulary saved · try it');
  }
  return true;
}

async function evaluateCueMotion(pose) {
  if (!state.isCueMode || state.isCalibrating || state.gestureAwaitRelease) return;
  if (captureCueMotion(pose)) return;
  const now = gestureNow();
  if (state.cuePhase === 'idle' || state.cuePhase === 'await-release' || !state.cueAnchor) beginLiveCueTracking(pose);

  if (state.cuePhase === 'cooldown') {
    if (pointDistance(pose.center, state.cueAnchor.center) > .045) {
      state.cueAnchor = pose;
      state.cueStillSince = now;
      return;
    }
    if (now >= state.cueCooldownUntil && now - state.cueStillSince > 260) beginLiveCueTracking(pose);
    return;
  }

  if (state.cuePhase === 'ready') {
    if (!beginsCueMotion(pose, state.cueAnchor)) {
      state.cueAnchor = blendPose(state.cueAnchor, pose, .05);
      return;
    }
    beginLiveCueTrace(pose, now);
    return;
  }

  if (state.cuePhase !== 'tracing') return;
  const previousPoint = state.motionBuffer.at(-1);
  if (previousPoint && now - previousPoint.at > 500) {
    beginLiveCueTracking(pose);
    return;
  }
  recordMotionPoint(pose);
  drawMotionTrail();

  if (state.cueTemplates.length < 3) {
    const hasEnoughGesture = now - state.cueStartedAt > 220 && motionPathLength(state.motionBuffer) > .055;
    if (!hasEnoughGesture) return;
    completeLiveCue(pose, now);
    await cueDrone();
    return;
  }

  const latest = state.motionBuffer.at(-1);
  const maximumDuration = Math.max(...state.cueTemplates.map(template => template.duration)) * 1.48;
  if (latest.at - state.motionBuffer[0].at > maximumDuration) {
    beginLiveCueTracking(pose);
    return;
  }
  const bestScore = Math.min(...state.cueTemplates.map(template => {
    const points = state.motionBuffer.filter(point => latest.at - point.at <= template.duration * 1.25);
    const duration = points.at(-1).at - points[0].at;
    if (points.length < 8 || duration < template.duration * .64 || duration > template.duration * 1.48) return Infinity;
    return cueTemplateScore(template, points);
  }));
  if (bestScore < CUE_MATCH_THRESHOLD) {
    completeLiveCue(pose, now);
    await cueDrone();
    return;
  }
  updateGestureState('tracing your cue · fist exits mode');
}

function resetGestureHold() {
  state.gestureHold = null;
  clearGestureCanvas();
  if (state.isCamera && !state.isCalibrating && !state.cueRecording) updateGestureState(state.isCueMode ? cuePrompt() : 'hold a fist to cue');
}

function saveCalibration(pose) {
  state.gestureCalibration = { ratios: pose.ratios, normal: pose.normal };
  localStorage.setItem('mimetry-cue', JSON.stringify(state.gestureCalibration));
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
  state.activeCueHandPosition = enteringCueMode ? state.smoothedPose?.center || null : null;
  state.gestureAwaitRelease = true;
  state.cueRecording = null;
  state.cuePhase = enteringCueMode ? 'await-release' : 'idle';
  state.cueAnchor = null;
  state.cueStartedAt = 0;
  state.cueStillSince = 0;
  resetVolumeMotion();
  state.autoTeachOnRelease = false;
  document.body.classList.remove('is-recording');
  clearMotionBuffer();
  clearStopBuffer();
  resetCueGate();
  resetGestureHold();
  updateControls();
  updateGestureState(state.isCueMode ? 'cue mode · release your hand' : 'cue mode released · release your hand');
  // Face tracking is only needed after cue mode is established for the ear
  // gesture. Deferring it keeps the initial fist countdown purely hand-driven.
  if (enteringCueMode) setTimeout(startFaceTracking, 450);
}

function evaluateGesture(pose) {
  const mode = state.isCalibrating ? 'calibrate' : 'cue';
  const candidate = isClosedFist(pose) && (state.isCalibrating || matchesCalibration(pose));
  if (!candidate) {
    const wasAwaitingRelease = state.gestureAwaitRelease;
    if (wasAwaitingRelease) {
      state.gestureAwaitRelease = false;
      resetGestureHold();
      if (state.isCueMode && !state.isCalibrating && !state.cueRecording) beginLiveCueTracking(pose);
    } else if (state.gestureHold) {
      resetGestureHold();
    }
    return;
  }
  if (state.gestureAwaitRelease) return;
  const now = gestureNow();
  if (!state.gestureHold || (state.isCalibrating && !isSteady(pose, state.gestureHold.pose))) {
    state.gestureHold = { pose, startedAt: now };
  } else {
    // Entering/exiting cue mode means holding the fist shape, not freezing the
    // arm in space. Keep the countdown attached to a naturally moving hand.
    state.gestureHold.pose = blendPose(state.gestureHold.pose, pose, .18);
  }
  const progress = Math.min(1, (now - state.gestureHold.startedAt) / 3000);
  updateGestureState(state.isCalibrating ? 'hold steady to save your cue' : state.isCueMode ? 'hold steady to leave cue mode' : 'hold steady to enter cue mode');
  drawGestureCue(pose, progress, mode);
  if (progress >= 1) {
    if (state.isCalibrating) saveCalibration(pose); else toggleCueMode();
  }
}

function onFaceResults(results) {
  state.faceLandmarks = results.multiFaceLandmarks?.[0] || null;
}

function onHandResults(results) {
  if (gestureTest.enabled) {
    gestureTest.processedFrames += 1;
    if (results.multiHandLandmarks?.length) gestureTest.handFrames += 1;
  }
  if (gestureTest.enabled && gestureTest.warmingUp) {
    gestureTest.warmupResolve?.();
    return;
  }
  const allHands = results.multiHandLandmarks || [];
  const handLabels = results.multiHandedness || [];
  let activeIndex = 0;
  if (state.isCueMode && (state.activeCueHandLabel || state.activeCueHandPosition)) {
    const matchingIndexes = handLabels
      .map((handedness, index) => handedness.label === state.activeCueHandLabel ? index : -1)
      .filter(index => index >= 0);
    const hasUniqueLabelMatch = matchingIndexes.length === 1;
    activeIndex = hasUniqueLabelMatch
      ? matchingIndexes[0]
      : matchingIndexes.reduce((closest, index) => {
        if (closest < 0 || !state.activeCueHandPosition) return index;
        const distance = pointDistance(handPose(allHands[index]).center, state.activeCueHandPosition);
        const closestDistance = pointDistance(handPose(allHands[closest]).center, state.activeCueHandPosition);
        return distance < closestDistance ? index : closest;
      }, -1);
    const selectedDistance = activeIndex >= 0 && state.activeCueHandPosition
      ? pointDistance(handPose(allHands[activeIndex]).center, state.activeCueHandPosition)
      : 0;
    if (activeIndex < 0 || (!hasUniqueLabelMatch && selectedDistance >= .3)) {
      activeIndex = closestCueHandIndex(allHands, state.activeCueHandPosition);
    }
  }
  const landmarks = activeIndex >= 0 ? allHands[activeIndex] : null;
  if (!landmarks) {
    resetEarGesture();
    resetOrbGrab();
    let recordingInterrupted = false;
    if (state.cueRecording) {
      if (state.cueRecording.phase === 'waiting' || state.cueRecording.phase === 'interlude') {
        updateGestureState(`cue sample ${state.cueTemplates.length + 1}/3 · show your cue hand`);
        return;
      }
      state.cueRecording.missingSince ||= gestureNow();
      if (gestureNow() - state.cueRecording.missingSince < 500) return;
      state.cueRecording = null;
      document.body.classList.remove('is-recording');
      resetCueGate();
      recordingInterrupted = true;
    }
    state.smoothedPose = null;
    if (state.isDrone && state.gestureCommandAwaitReset) {
      state.gestureCommandMissingSince ||= gestureNow();
      if (gestureNow() - state.gestureCommandMissingSince >= 500) completeGestureCommandReset();
    }
    if (state.isDrone) resetVolumeMotion();
    if (!state.isCueMode || state.cueRecording || state.isCalibrating) {
      clearMotionBuffer();
      resetGestureHold();
    } else {
      state.gestureHold = null;
      updateGestureState('cue mode ready · show your cue hand');
    }
    if (recordingInterrupted) updateGestureState('recording paused · show your hand and try again');
    return;
  }
  state.currentHandLabel = handLabels[activeIndex]?.label || null;
  state.gestureCommandMissingSince = 0;
  const pose = smoothPose(handPose(landmarks));
  if (gestureTest.enabled) {
    reportGestureTest('pose-frame', {
      frame: {
        at: gestureNow(),
        center: pose.center,
        fingerCenter: pose.fingerCenter,
        width: pose.width,
        spread: pose.spread,
        extension: handExtension(pose),
        ratios: pose.ratios,
        grip: handGrip(pose),
        isFist: isClosedFist(pose),
        cuePhase: state.cuePhase,
        isDrone: state.isDrone,
        awaitingReset: state.gestureCommandAwaitReset
      }
    });
  }
  if (state.isCueMode) state.activeCueHandPosition = pose.center;
  if (state.cueRecording) {
    state.cueRecording.missingSince = null;
    captureCueMotion(pose);
    return;
  }
  const isFist = isClosedFist(pose) && (state.isCalibrating || matchesCalibration(pose));
  if (evaluateOrbGrab(pose)) return;
  if (evaluateEarListeningGesture(pose)) return;
  if (state.isDrone) {
    if (evaluateGestureCommandReset(pose)) {
      evaluateGesture(pose);
      return;
    }
    if (evaluateReleaseLoop(pose)) return;
    if (evaluateVolumeGesture(pose)) return;
    evaluateGesture(pose);
    return;
  }
  evaluateGesture(pose);
  if (!isFist) evaluateCueMotion(pose);
}

async function handTrackingLoop() {
  if (!state.handLoopRunning || !state.isCamera) return;
  const frameTime = el.camera.currentTime;
  const hasNewFixtureFrame = !gestureTest.enabled || Math.abs(frameTime - gestureTest.lastFrameTime) >= .025;
  if (el.camera.readyState >= 2 && hasNewFixtureFrame) {
    gestureTest.lastFrameTime = frameTime;
    // Hands own the interaction frame rate. Face landmarks only enrich the
    // ear-point gesture, so they run opportunistically rather than delaying
    // fist/cue recognition.
    if (!gestureTest.enabled && state.faceMesh && !state.faceTrackingBusy && performance.now() - state.lastFaceTrackingAt > 125) {
      state.faceTrackingBusy = true;
      state.lastFaceTrackingAt = performance.now();
      state.faceMesh.send({ image: el.camera })
        .catch(() => { state.faceLandmarks = null; })
        .finally(() => { state.faceTrackingBusy = false; });
    }
    await state.hands.send({ image: el.camera });
  }
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
    state.hands.onResults(onHandResults);
  }
  state.hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: .46, minTrackingConfidence: .48 });
  state.handLoopRunning = true;
  updateGestureState(state.isCueMode ? cuePrompt() : 'hold a fist to cue');
  handTrackingLoop();
}

function startFaceTracking() {
  if (!state.isCamera || !state.isCueMode || state.faceMesh || typeof window.FaceMesh !== 'function') return;
  state.faceMesh = new window.FaceMesh({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
  state.faceMesh.onResults(onFaceResults);
  state.faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: .5, minTrackingConfidence: .5 });
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
      localStorage.setItem('mimetry-descriptors', JSON.stringify([...state.selectedDescriptors]));
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
  document.body.classList.toggle('drone-active', state.isDrone);
  el.status.classList.toggle('active', state.isDrone || state.isListening);
  el.statusText.textContent = state.isListening ? 'FIELD LISTENING' : state.isDrone ? 'DRONE OPEN' : 'DRONE STANDBY';
  el.mic.classList.toggle('active', state.isListening); el.mic.textContent = state.isListening ? 'listening · stop' : 'enable listening';
  el.volumeOutput.value = `${Math.round(state.volume)}%`;
  el.volumeHudValue.textContent = String(Math.round(state.volume));
  el.volumeHudMeter.style.width = `${state.volume}%`;
  el.volumeHud.style.setProperty('--volume-scale', String(.72 + state.volume / 100 * .56));
  el.warmthOutput.value = state.warmth < 35 ? 'pure' : state.warmth < 72 ? 'warm' : 'blooming';
  el.sensitivityOutput.value = state.sensitivity < 35 ? 'focused' : state.sensitivity < 72 ? 'balanced' : 'open';
  el.target.textContent = state.isCueMode ? `CUE MODE · ${noteNames[state.key]}` : state.isListening ? `LISTENING · FIND ${noteNames[state.key]}` : `TONIC · ${noteNames[state.key]}`;
  updateFifthsOverlay();
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
if (gestureTest.enabled) enterFixtureCamera();
