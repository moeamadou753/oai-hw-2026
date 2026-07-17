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
  mic: document.getElementById('mic-button'), pitch: document.getElementById('pitch-readout'), pitchDetail: document.getElementById('pitch-detail'),
  descriptors: document.getElementById('descriptors'), target: document.getElementById('target-label'), status: document.querySelector('.status'),
  statusText: document.getElementById('status-text'), lessonText: document.getElementById('lesson-text'), lessonMeter: document.getElementById('lesson-meter-fill'),
  about: document.getElementById('about-dialog'), aboutTrigger: document.getElementById('about-trigger'), aboutClose: document.getElementById('about-close')
};

noteNames.forEach((name, index) => {
  const option = new Option(name, index === 0 ? '0' : String(index));
  el.key.add(option);
});

const state = { audio: null, droneGain: null, droneNodes: [], lfoNodes: [], isDrone: false, analyser: null, micStream: null, isListening: false, key: 0, octave: 3, warmth: 54, volume: 48, detected: null, targetHistory: [], selectedDescriptors: new Set(JSON.parse(localStorage.getItem('tonal-field-descriptors') || '[]')) };
const ctx = el.canvas.getContext('2d');
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
  const harmonicMix = [1, .42, .18, .085, .035];
  const warmth = state.warmth / 100;
  harmonicMix.forEach((level, index) => {
    const oscillator = state.audio.createOscillator();
    const partialGain = state.audio.createGain();
    const lfo = state.audio.createOscillator();
    const lfoGain = state.audio.createGain();
    const harmonicAmount = index === 0 ? 1 : Math.pow(warmth, index * .5);
    oscillator.type = index < 2 ? 'sine' : 'triangle';
    oscillator.frequency.value = fundamental * (index + 1);
    partialGain.gain.value = level * harmonicAmount / (index === 0 ? 1 : 1.8);
    lfo.frequency.value = .027 + index * .013;
    lfoGain.gain.value = Math.max(.001, partialGain.gain.value * (.08 + warmth * .13));
    lfo.connect(lfoGain).connect(partialGain.gain);
    oscillator.connect(partialGain).connect(state.droneGain);
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 } });
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

function autoCorrelate(buffer, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < .012) return null;
  const size = buffer.length;
  let start = 0; let end = size - 1;
  while (start < size / 2 && Math.abs(buffer[start]) < .16) start++;
  while (end > size / 2 && Math.abs(buffer[end]) < .16) end--;
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
  if (maxIndex <= 0 || max < .1) return null;
  const left = correlations[maxIndex - 1] || correlations[maxIndex];
  const right = correlations[maxIndex + 1] || correlations[maxIndex];
  const shift = (right - left) / (2 * (2 * correlations[maxIndex] - right - left));
  const period = maxIndex + (Number.isFinite(shift) ? shift : 0);
  const frequency = sampleRate / period;
  return frequency >= 65 && frequency <= 1350 ? { frequency, confidence: Math.min(1, rms * 15) } : null;
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
  el.orbCopy.innerHTML = state.isDrone ? 'release<br />home' : 'hold<br />home';
  el.status.classList.toggle('active', state.isDrone || state.isListening);
  el.statusText.textContent = state.isDrone ? 'DRONE OPEN' : state.isListening ? 'LISTENING' : 'DRONE STANDBY';
  el.mic.classList.toggle('active', state.isListening); el.mic.textContent = state.isListening ? 'listening · stop' : 'enable listening';
  el.volumeOutput.value = `${state.volume}%`;
  el.warmthOutput.value = state.warmth < 35 ? 'pure' : state.warmth < 72 ? 'warm' : 'blooming';
  el.target.textContent = `TONIC · ${noteNames[state.key]}`;
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
    if (state.isListening) { el.pitch.textContent = 'listen'; el.pitchDetail.textContent = 'give the field one clear note'; }
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
el.warmth.addEventListener('input', event => { state.warmth = Number(event.target.value); updateControls(); if (state.isDrone) updateDrone(); });
el.volume.addEventListener('input', event => { state.volume = Number(event.target.value); updateControls(); if (state.isDrone) state.droneGain.gain.linearRampToValueAtTime((state.volume / 100) * .18, state.audio.currentTime + .08); });
el.aboutTrigger.addEventListener('click', () => el.about.showModal());
el.aboutClose.addEventListener('click', () => el.about.close());
el.about.addEventListener('click', event => { if (event.target === el.about) el.about.close(); });

updateDescriptors(0); updateControls(); requestAnimationFrame(draw);
setInterval(() => { readPitch(); updateLiveCopy(); }, 70);
