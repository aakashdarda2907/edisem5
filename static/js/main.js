function getCookie(name) {
  const match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return match ? match.pop() : '';
}
const csrftoken = getCookie('csrftoken');

async function postJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

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

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => handleTranscript(chip.dataset.q));
});
const steps = [...document.querySelectorAll('.step')];
const emptyResults = document.getElementById('emptyResults');
const resultsArea = document.getElementById('resultsArea');



let currentTranscript = '';
let currentSQL = '';
let currentColumns = [];
let currentRows = [];
const downloadCsvBtn = document.getElementById('downloadCsvBtn');

function formatHeader(col) {
  return col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatValue(v) {
  if (typeof v === 'number') return v.toLocaleString('en-IN');
  return v;
}

function setStatus(state) {
  const map = { idle: 'idle', listening: 'listening', understood: 'understood', waiting: 'awaiting confirmation', running: 'running query', done: 'done', error: 'error' };
  statusText.textContent = map[state] || state;
  statusPill.classList.toggle('live', state !== 'idle');
}

function resetForNewQuery() {
  blockTranscript.classList.remove('show');
  blockQuery.classList.remove('show');
  blockRevised.classList.remove('show');
  blockError.classList.remove('show');
  reviseRow.style.display = 'none';
  confirmRow.style.display = 'flex';
  steps.forEach(s => s.classList.remove('done', 'doing'));
  emptyResults.style.display = 'block';
  resultsArea.querySelectorAll('table, .results-meta').forEach(el => el.remove());
  btnYes.disabled = false; btnNo.disabled = false;
  downloadCsvBtn.style.display = 'none';
  currentColumns = []; currentRows = [];
}


function showError(message) {
  errorText.textContent = message;
  blockError.classList.add('show');
  setStatus('error');
}

async function handleTranscript(transcript) {
  resetForNewQuery();
  currentTranscript = transcript;
  transcriptText.innerHTML = transcript;
  blockTranscript.classList.add('show');
  setStatus('understood');

  try {
    const result = await postJSON('/generate-query/', { transcript });
    currentSQL = result.sql;
    queryText.textContent = result.sql;
    explainText.textContent = result.explanation || '';
    blockQuery.classList.add('show');
    setStatus('waiting');
  } catch (err) {
    showError(err.message);
  }
}

// --- Voice capture (Web Speech API), with typed fallback ---
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

  recognition.onerror = () => showError('Could not capture voice. Try again or type instead.');

  recognition.onend = () => {
    micBtn.classList.remove('active');
    wave.classList.remove('active');
    micHint.textContent = 'Tap the mic and ask something about the tables on the right.';
  };
}

fallbackSend.addEventListener('click', () => {
  if (fallbackInput.value.trim()) handleTranscript(fallbackInput.value.trim());
});

// --- Confirm / deny / revise ---
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
    const result = await postJSON('/revise-query/', { previous_sql: currentSQL, correction });
    currentSQL = result.sql;
    revisedQueryText.textContent = result.sql;
    reviseRow.style.display = 'none';
    blockRevised.classList.add('show');
  } catch (err) {
    showError(err.message);
  }
});

btnYes.addEventListener('click', () => runQuery(''));
btnYes2.addEventListener('click', () => runQuery(reviseInput.value.trim()));

async function runQuery(correction) {
  btnYes.disabled = true; btnNo.disabled = true;
  setStatus('running');
  steps.forEach(s => s.classList.remove('done', 'doing'));

  let i = 0;
  const stepTimer = setInterval(() => {
    if (i > 0) { steps[i - 1].classList.remove('doing'); steps[i - 1].classList.add('done'); }
    if (i < steps.length) { steps[i].classList.add('doing'); i++; }
    else clearInterval(stepTimer);
  }, 350);

  try {
    const result = await postJSON('/run-query/', {
      sql: currentSQL, transcript: currentTranscript, correction,
    });
    setTimeout(() => {
      steps.forEach(s => { s.classList.remove('doing'); s.classList.add('done'); });
      showResults(result.columns, result.rows);
      setStatus('done');
    }, steps.length * 350 + 100);
  } catch (err) {
    clearInterval(stepTimer);
    showError(err.message);
  }
}
function showResults(columns, rows) {
  currentColumns = columns;
  currentRows = rows;
  emptyResults.style.display = 'none';
  const table = document.createElement('table');
  table.className = 'results';
  table.innerHTML = `
    <thead><tr>${columns.map(c => `<th>${formatHeader(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${formatValue(v)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  resultsArea.appendChild(table);
  const meta = document.createElement('div');
  meta.className = 'results-meta';
  meta.innerHTML = `<span>${rows.length} rows</span>`;
  resultsArea.appendChild(meta);
  downloadCsvBtn.style.display = rows.length ? 'inline-block' : 'none';
}

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
let requestInFlight = false;
async function handleTranscript(transcript) {
  if (requestInFlight) return;
  requestInFlight = true;
  document.querySelectorAll('.chip').forEach(c => c.disabled = true);

  resetForNewQuery();
  currentTranscript = transcript;
  transcriptText.innerHTML = transcript;
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
  } catch (err) {
    showError(err.message);
  } finally {
    requestInFlight = false;
    micHint.textContent = 'Tap the mic and ask something about the tables on the right.';
    document.querySelectorAll('.chip').forEach(c => c.disabled = false);
  }
}


document.getElementById('copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(currentSQL);
  const btn = document.getElementById('copyBtn');
  btn.textContent = 'Copied';
  setTimeout(() => btn.textContent = 'Copy', 1200);
});