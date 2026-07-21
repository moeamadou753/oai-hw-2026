const fixtures = [
  { id: 'start', file: 'gesture-fixtures/start.mp4', expected: ['start'], duration: 11.31 },
  { id: 'start-stop', file: 'gesture-fixtures/start-stop.mp4', expected: ['start', 'stop'], duration: 12.49 },
  { id: 'start-raise', file: 'gesture-fixtures/start-raise.mp4', expected: ['start', 'raise'], duration: 14.93 },
  { id: 'start-lower', file: 'gesture-fixtures/start-lower.mp4', expected: ['start', 'lower'], duration: 13.8 },
  { id: 'start-raise-stop', file: 'gesture-fixtures/start-raise-stop.mp4', expected: ['start', 'raise', 'stop'], duration: 14.34 },
  { id: 'start-lower-stop', file: 'gesture-fixtures/start-lower-stop.mp4', expected: ['start', 'lower', 'stop'], duration: 14.65 },
  { id: 'start-raise-lower', file: 'gesture-fixtures/start-raise-lower.mp4', expected: ['start', 'raise', 'lower'], duration: 15.21 },
  { id: 'start-raise-lower-raise-stop', file: 'gesture-fixtures/start-raise-lower-raise-stop.mp4', expected: ['start', 'raise', 'lower', 'raise', 'stop'], duration: 21.6 }
];

const el = {
  list: document.getElementById('fixture-list'),
  frame: document.getElementById('fixture-frame'),
  stageEmpty: document.getElementById('stage-empty'),
  runAll: document.getElementById('run-all'),
  stop: document.getElementById('stop-run'),
  passed: document.getElementById('passed-count'),
  failed: document.getElementById('failed-count'),
  pending: document.getElementById('pending-count'),
  suiteStatus: document.getElementById('suite-status'),
  currentLabel: document.getElementById('current-label'),
  currentTitle: document.getElementById('current-title'),
  currentState: document.getElementById('current-state'),
  expected: document.getElementById('expected-events'),
  observed: document.getElementById('observed-events'),
  log: document.getElementById('event-log')
};

const results = new Map();
const report = {};
const reportElement = document.getElementById('gesture-report');
let activeRun = null;
let suiteCancelled = false;

function sequenceMarkup(events, expected = []) {
  return events.map((event, index) => {
    const status = expected.length ? (event === expected[index] ? 'matched' : 'extra') : '';
    return `<span class="event-chip ${status}">${event}</span>`;
  }).join('');
}

function renderFixtures() {
  el.list.innerHTML = fixtures.map(fixture => {
    const result = results.get(fixture.id);
    const stateClass = result?.status || '';
    const label = result?.status === 'passed' ? 'pass' : result?.status === 'failed' ? `fail · ${result.observed.join(' → ') || 'no events'}` : result?.status === 'running' ? 'running' : 'not run';
    return `<li class="fixture-row ${stateClass}" data-fixture="${fixture.id}">
      <div>
        <div class="fixture-name">${fixture.id.replaceAll('-', ' · ')}</div>
        <div class="fixture-meta"><span>${fixture.duration.toFixed(1)}s</span><span>·</span><span class="fixture-result">${label}</span></div>
      </div>
      <button type="button" data-run="${fixture.id}" ${activeRun ? 'disabled' : ''}>run</button>
    </li>`;
  }).join('');

  el.list.querySelectorAll('[data-run]').forEach(button => {
    button.addEventListener('click', () => runFixture(fixtures.find(fixture => fixture.id === button.dataset.run)));
  });
  const passed = [...results.values()].filter(result => result.status === 'passed').length;
  const failed = [...results.values()].filter(result => result.status === 'failed').length;
  el.passed.textContent = String(passed);
  el.failed.textContent = String(failed);
  el.pending.textContent = String(fixtures.length - passed - failed);
}

function setRunState(state) {
  el.currentState.className = `state-pill ${state}`;
  el.currentState.textContent = state;
}

function logEvent(message) {
  const item = document.createElement('li');
  item.textContent = message;
  el.log.append(item);
  el.log.scrollTop = el.log.scrollHeight;
}

function exactMatch(expected, observed) {
  return expected.length === observed.length && expected.every((event, index) => event === observed[index]);
}

function stopActiveRun(reason = 'stopped') {
  if (!activeRun) return;
  clearTimeout(activeRun.timeout);
  activeRun.resolve({ status: 'cancelled', reason });
  activeRun = null;
  el.frame.removeAttribute('src');
  el.frame.classList.remove('active');
  el.stop.disabled = true;
  renderFixtures();
}

function runFixture(fixture) {
  if (activeRun) return Promise.resolve({ status: 'busy' });
  const runId = `${fixture.id}-${Date.now()}`;
  const observed = [];
  results.set(fixture.id, { status: 'running', observed });
  renderFixtures();
  el.currentLabel.textContent = `Fixture · ${fixture.duration.toFixed(1)} seconds`;
  el.currentTitle.textContent = fixture.id.replaceAll('-', ' · ');
  el.expected.innerHTML = sequenceMarkup(fixture.expected);
  el.observed.innerHTML = '';
  el.log.replaceChildren();
  el.stageEmpty.classList.add('hidden');
  el.frame.classList.add('active');
  el.stop.disabled = false;
  setRunState('running');
  logEvent('loading fixture through production camera pipeline');

  return new Promise(resolve => {
    const timeout = setTimeout(() => finishFixture('timeout'), (fixture.duration + 22) * 1000);
    activeRun = { fixture, runId, observed, trace: [], timeout, resolve };
    const query = new URLSearchParams({ gestureFixture: fixture.file, gestureRun: runId });
    el.frame.src = `index.html?${query}`;
  });
}

function finishFixture(reason = 'ended') {
  if (!activeRun) return;
  const { fixture, observed, resolve, timeout } = activeRun;
  clearTimeout(timeout);
  const passed = reason === 'ended' && exactMatch(fixture.expected, observed);
  const result = {
    status: passed ? 'passed' : 'failed',
    expected: [...fixture.expected],
    observed: [...observed],
    reason,
    trace: activeRun.trace
  };
  results.set(fixture.id, result);
  report[fixture.id] = result;
  reportElement.textContent = JSON.stringify(report);
  activeRun = null;
  el.stop.disabled = true;
  setRunState(result.status);
  logEvent(passed ? 'sequence matched exactly' : `sequence mismatch · ${reason}`);
  renderFixtures();
  resolve(result);
}

window.addEventListener('message', event => {
  if (!activeRun || event.origin !== window.location.origin || event.source !== el.frame.contentWindow) return;
  const message = event.data;
  if (!message || message.source !== 'tonal-field-gesture-test' || message.runId !== activeRun.runId) return;
  if (message.kind === 'fixture-started') {
    logEvent(`video started · ${Number(message.duration).toFixed(2)}s`);
    return;
  }
  if (message.kind === 'gesture-event') {
    activeRun.observed.push(message.event.type);
    el.observed.innerHTML = sequenceMarkup(activeRun.observed, activeRun.fixture.expected);
    logEvent(`${(message.event.at / 1000).toFixed(2)}s · ${message.event.type}`);
    return;
  }
  if (message.kind === 'pose-frame') {
    activeRun.trace.push(message.frame);
    return;
  }
  if (message.kind === 'fsm-state') {
    logEvent(`${(message.at / 1000).toFixed(2)}s · state · ${message.state}`);
    return;
  }
  if (message.kind === 'fixture-error') {
    logEvent(`fixture error · ${message.message}`);
    finishFixture('error');
    return;
  }
  if (message.kind === 'fixture-ended') {
    const coverage = message.processedFrames ? Math.round(message.handFrames / message.processedFrames * 100) : 0;
    logEvent(`tracking · ${message.handFrames}/${message.processedFrames} frames with a hand · ${coverage}%`);
    finishFixture('ended');
  }
});

el.runAll.addEventListener('click', async () => {
  if (activeRun) return;
  suiteCancelled = false;
  el.runAll.disabled = true;
  el.suiteStatus.textContent = 'Suite running at natural speed. Each fixture starts from a clean state.';
  for (const fixture of fixtures) {
    if (suiteCancelled) break;
    await runFixture(fixture);
  }
  el.runAll.disabled = false;
  el.suiteStatus.textContent = suiteCancelled ? 'Suite stopped.' : 'Suite complete. Any extra, missing, or out-of-order event is a failure.';
});

el.stop.addEventListener('click', () => {
  suiteCancelled = true;
  stopActiveRun();
  el.runAll.disabled = false;
  el.suiteStatus.textContent = 'Run stopped.';
  setRunState('idle');
});

renderFixtures();
