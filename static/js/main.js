// ============================================================
// VoxQuery - Main JavaScript
// Includes API Usage Meter and Response Time chart (Task 2),
// and CSV export (Sanika)
// ============================================================

let responseTimeHistory = [];

// ============================================================
// CSRF
// ============================================================

function getCookie(name) {
  const match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return match ? match.pop() : '';
}

const csrftoken = getCookie('csrftoken');

// ============================================================
// POST HELPER
// ============================================================

async function postJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrftoken
    },
    body: JSON.stringify(data),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

// ============================================================
// TASK 2: RESPONSE TIME CHART
// ============================================================

function updatePerformanceStats() {
  const latestEl = document.getElementById("latestResponseTime");
  const countEl = document.getElementById("queryCount");
  const avgEl = document.getElementById("averageResponseTime");

  if (!latestEl || !countEl || !avgEl) return;

  const count = responseTimeHistory.length;
  const latest = responseTimeHistory[count - 1];

  latestEl.textContent = count ? `${latest.toFixed(2)} ms` : '—';
  countEl.textContent = count;
  const total = responseTimeHistory.reduce((sum, t) => sum + t, 0);
  avgEl.textContent = count ? `${(total / count).toFixed(2)} ms` : '—';
}

function renderResponseTimeChart() {
  const canvas = document.getElementById("responseTimeChart");
  const emptyState = document.getElementById("chartEmpty");

  if (!canvas) return;

  updatePerformanceStats();

  if (responseTimeHistory.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);

  const padding = 24;
  const plotW = width - padding * 2;
  const plotH = height - padding * 2;

  const maxTime = Math.max(...responseTimeHistory, 1);
  const barCount = responseTimeHistory.length;
  const gap = 10;
  const barWidth = (plotW - gap * (barCount - 1)) / barCount;

  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';

  responseTimeHistory.forEach((time, index) => {
    const barHeight = Math.max((time / maxTime) * plotH, 4);
    const x = padding + index * (barWidth + gap);
    const y = padding + (plotH - barHeight);

    ctx.fillStyle = '#4fa98c';
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = '#8d95a3';
    ctx.fillText(`${Math.round(time)}`, x + barWidth / 2, y - 6);

    ctx.fillStyle = '#5c6270';
    ctx.fillText(`Q${index + 1}`, x + barWidth / 2, height - padding + 14);
  });
}

// ============================================================
// API USAGE METER
// ============================================================

const usageCount = document.getElementById('usageCount');
const usageProgress = document.getElementById('usageProgress');

const DAILY_QUOTA = 20;

function updateUsageMeter(count) {
  if (!usageCount || !usageProgress) return;

  usageCount.textContent = count;

  const safeCount = Math.max(0, Number(count) || 0);
  const percentage = Math.min(safeCount / DAILY_QUOTA, 1);
  const circumference = 175.93;
  const offset = circumference - (percentage * circumference);

  usageProgress.style.strokeDashoffset = offset;
}

async function loadUsageMeter() {
  try {
    const response = await fetch('/api-usage/');
    if (!response.ok) throw new Error('Could not load API usage.');
    const data = await response.json();
    updateUsageMeter(data.count);
  } catch (error) {
    console.error('Could not load API usage:', error);
  }
}

loadUsageMeter();

// ============================================================
// DOM ELEMENTS
// ============================================================

const micBtn = document.getElementById('micBtn');
const wave = document.getElementById('wave');
const micHint = document.getElementById('micHint');

const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');

const fallbackRow = document.getElementById('fallbackRow');
const fallbackInput = document.getElementById('fallbackInput');
const fallbackSend = document.getElementById('fallbackSend');

const blockTranscript = document.getElementById('blockTranscript');
const transcriptText = document.getElementById('transcriptText');
const blockQuery = document.getElementById('blockQuery');
const queryText = document.getElementById('queryText');
const explainText = document.getElementById('explainText');
const confirmRow = document.getElementById('confirmRow');
const reviseRow = document.getElementById('reviseRow');
const reviseInput = document.getElementById('reviseInput');
const blockRevised = document.getElementById('blockRevised');
const revisedQueryText = document.getElementById('revisedQueryText');
const blockError = document.getElementById('blockError');
const errorText = document.getElementById('errorText');

const btnYes = document.getElementById('btnYes');
const btnNo = document.getElementById('btnNo');
const btnRevise = document.getElementById('btnRevise');
const btnYes2 = document.getElementById('btnYes2');

const steps = [...document.querySelectorAll('.step')];

const emptyResults = document.getElementById('emptyResults');
const resultsArea = document.getElementById('resultsArea');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');

// ============================================================
// STATE
// ============================================================

let currentTranscript = '';
let currentSQL = '';
let currentColumns = [];
let currentRows = [];
let requestInFlight = false;

// ============================================================
// FORMATTING
// ============================================================

function formatHeader(col) {
  return col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatValue(v) {
  if (typeof v === 'number') return v.toLocaleString('en-IN');
  return v;
}

// ============================================================
// STATUS
// ============================================================

function setStatus(state) {
  const map = {
    idle: 'idle',
    listening: 'listening',
    understood: 'understood',
    waiting: 'awaiting confirmation',
    running: 'running query',
    done: 'done',
    error: 'error'
  };

  statusText.textContent = map[state] || state;
  statusPill.classList.toggle('live', state !== 'idle');
}

// ============================================================
// RESET UI
// ============================================================

function resetForNewQuery() {
  blockTranscript.classList.remove('show');
  blockQuery.classList.remove('show');
  blockRevised.classList.remove('show');
  blockError.classList.remove('show');

  reviseRow.style.display = 'none';
  confirmRow.style.display = 'flex';

  steps.forEach(step => {
    step.classList.remove('done', 'doing');
  });

  emptyResults.style.display = 'block';

  resultsArea.querySelectorAll('table, .results-meta').forEach(el => el.remove());

  btnYes.disabled = false;
  btnNo.disabled = false;

  downloadCsvBtn.style.display = 'none';
  currentColumns = [];
  currentRows = [];
}

// ============================================================
// ERROR
// ============================================================

function showError(message) {
  errorText.textContent = message;
  blockError.classList.add('show');
  setStatus('error');
}

// ============================================================
// HANDLE USER TRANSCRIPT
// ============================================================

async function handleTranscript(transcript) {
  if (requestInFlight) return;

  requestInFlight = true;

  document.querySelectorAll('.chip').forEach(chip => {
    chip.disabled = true;
  });

  resetForNewQuery();

  currentTranscript = transcript;
  transcriptText.textContent = transcript;
  blockTranscript.classList.add('show');

  setStatus('understood');
  micHint.textContent = 'Thinking…';

  try {
    const result = await postJSON('/generate-query/', { transcript });

    currentSQL = result.sql;
    queryText.textContent = result.sql;
    explainText.textContent = result.explanation || '';

    blockQuery.classList.add('show');
    setStatus('waiting');

    await loadUsageMeter();

  } catch (err) {
    showError(err.message);
  } finally {
    requestInFlight = false;
    micHint.textContent = 'Tap the mic and ask something about the tables on the right.';
    document.querySelectorAll('.chip').forEach(chip => {
      chip.disabled = false;
    });
  }
}

// ============================================================
// SAMPLE QUESTIONS
// ============================================================

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    handleTranscript(chip.dataset.q);
  });
});

// ============================================================
// VOICE CAPTURE
// ============================================================

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
  micBtn.style.display = 'none';
  fallbackRow.style.display = 'flex';
  micHint.textContent = 'Voice capture isn\'t supported in this browser — type your question instead.';
} else {
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;

  micBtn.addEventListener('click', () => {
    micBtn.classList.add('active');
    wave.classList.add('active');
    micHint.textContent = 'Listening…';
    setStatus('listening');
    recognition.start();
  });

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    handleTranscript(transcript);
  };

  recognition.onerror = () => {
    showError('Could not capture voice. Try again or type instead.');
  };

  recognition.onend = () => {
    micBtn.classList.remove('active');
    wave.classList.remove('active');
    micHint.textContent = 'Tap the mic and ask something about the tables on the right.';
  };
}

// ============================================================
// TEXT FALLBACK
// ============================================================

fallbackSend.addEventListener('click', () => {
  const text = fallbackInput.value.trim();
  if (text) handleTranscript(text);
});

fallbackInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    const text = fallbackInput.value.trim();
    if (text) handleTranscript(text);
  }
});

// ============================================================
// CONFIRM / DENY / REVISE
// ============================================================

btnNo.addEventListener('click', () => {
  confirmRow.style.display = 'none';
  reviseRow.style.display = 'flex';
  reviseInput.value = '';
  reviseInput.focus();
});

btnRevise.addEventListener('click', async () => {
  const correction = reviseInput.value.trim();
  if (!correction) return;

  try {
    const result = await postJSON('/revise-query/', {
      previous_sql: currentSQL,
      correction
    });

    currentSQL = result.sql;
    revisedQueryText.textContent = result.sql;

    reviseRow.style.display = 'none';
    blockRevised.classList.add('show');

    await loadUsageMeter();

  } catch (err) {
    showError(err.message);
  }
});

btnYes.addEventListener('click', () => runQuery(''));
btnYes2.addEventListener('click', () => runQuery(reviseInput.value.trim()));

// ============================================================
// RUN DATABASE QUERY
// ============================================================

async function runQuery(correction) {
  btnYes.disabled = true;
  btnNo.disabled = true;

  setStatus('running');

  steps.forEach(step => {
    step.classList.remove('done', 'doing');
  });

  let i = 0;
  const stepTimer = setInterval(() => {
    if (i > 0) {
      steps[i - 1].classList.remove('doing');
      steps[i - 1].classList.add('done');
    }
    if (i < steps.length) {
      steps[i].classList.add('doing');
      i++;
    } else {
      clearInterval(stepTimer);
    }
  }, 350);

  try {
    const result = await postJSON('/run-query/', {
      sql: currentSQL,
      transcript: currentTranscript,
      correction
    });

    setTimeout(() => {
      steps.forEach(step => {
        step.classList.remove('doing');
        step.classList.add('done');
      });

      showResults(result.columns, result.rows, result.response_time_ms);
      setStatus('done');
    }, steps.length * 350 + 100);

  } catch (err) {
    clearInterval(stepTimer);
    showError(err.message);
  }
}

// ============================================================
// SHOW RESULTS
// ============================================================

function showResults(columns, rows, responseTimeMs = null) {
  currentColumns = columns;
  currentRows = rows;

  emptyResults.style.display = 'none';

  // ================= TASK 2 =================
  if (responseTimeMs !== null && responseTimeMs !== undefined) {
    const time = Number(responseTimeMs);
    if (!Number.isNaN(time)) {
      responseTimeHistory.push(time);
      if (responseTimeHistory.length > 10) responseTimeHistory.shift();
      renderResponseTimeChart();
    }
  }
  // ===========================================

  const table = document.createElement('table');
  table.className = 'results';

  table.innerHTML = `
    <thead>
      <tr>${columns.map(c => `<th>${formatHeader(c)}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${rows.map(r => `<tr>${r.map(v => `<td>${formatValue(v)}</td>`).join('')}</tr>`).join('')}
    </tbody>
  `;

  resultsArea.appendChild(table);

  const meta = document.createElement('div');
  meta.className = 'results-meta';

  let responseTimeText = '';
  if (responseTimeMs !== null && responseTimeMs !== undefined) {
    responseTimeText = `<span>Response time: ${Number(responseTimeMs).toFixed(2)} ms</span>`;
  }

  meta.innerHTML = `<span>${rows.length} rows</span>${responseTimeText}`;
  resultsArea.appendChild(meta);

  downloadCsvBtn.style.display = rows.length ? 'inline-block' : 'none';
}

// ============================================================
// CSV EXPORT
// ============================================================

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildCSV(columns, rows) {
  const lines = [columns.map(csvEscape).join(',')];
  rows.forEach(r => lines.push(r.map(csvEscape).join(',')));
  return lines.join('\r\n');
}

downloadCsvBtn.addEventListener('click', () => {
  if (!currentRows.length) return;
  const csv = buildCSV(currentColumns, currentRows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `voxquery-results-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ============================================================
// COPY SQL
// ============================================================

document.getElementById('copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(currentSQL);

  const btn = document.getElementById('copyBtn');
  btn.textContent = 'Copied';
  setTimeout(() => {
    btn.textContent = 'Copy';
  }, 1200);
});