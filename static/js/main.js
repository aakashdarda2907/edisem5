// ============================================================
// VoxQuery - Main JavaScript
// Includes API Usage Meter for Task 1
// ============================================================


// ============================================================
// CSRF
// ============================================================

function getCookie(name) {
  const match = document.cookie.match(
    '(^|;)\\s*' + name + '\\s*=\\s*([^;]+)'
  );

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

  if (!res.ok) {
    throw new Error(body.error || 'Request failed');
  }

  return body;
}


// ============================================================
// API USAGE METER
// ============================================================

const usageCount = document.getElementById('usageCount');
const usageProgress = document.getElementById('usageProgress');

/*
  IMPORTANT:
  The assignment guide does not specify the numeric daily quota.

  Keep this value configurable until your team confirms the quota
  they want the UI to display.

  Example:
  If your team decides the displayed quota is 20,
  change this to 20.
*/
const DAILY_QUOTA = 20;


/**
 * Update the circular usage gauge.
 */
function updateUsageMeter(count) {

  if (!usageCount || !usageProgress) {
    return;
  }


  // Display the current number of Gemini calls.

  usageCount.textContent = count;


  // Prevent invalid values.

  const safeCount = Math.max(0, Number(count) || 0);


  // Calculate percentage of the configured daily quota.

  const percentage = Math.min(
    safeCount / DAILY_QUOTA,
    1
  );


  // Circle circumference.
  // r = 28
  // circumference = 2 × π × 28 ≈ 175.93

  const circumference = 175.93;


  // Calculate how much of the circle should remain empty.

  const offset =
    circumference -
    (percentage * circumference);


  usageProgress.style.strokeDashoffset = offset;
}


/**
 * Get today's Gemini API usage from Django.
 */
async function loadUsageMeter() {

  try {

    const response = await fetch('/api-usage/');

    if (!response.ok) {
      throw new Error('Could not load API usage.');
    }

    const data = await response.json();

    updateUsageMeter(data.count);

  } catch (error) {

    console.error(
      'Could not load API usage:',
      error
    );

  }
}


// Load usage when page opens.

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

const blockTranscript =
  document.getElementById('blockTranscript');

const transcriptText =
  document.getElementById('transcriptText');

const blockQuery =
  document.getElementById('blockQuery');

const queryText =
  document.getElementById('queryText');

const explainText =
  document.getElementById('explainText');

const confirmRow =
  document.getElementById('confirmRow');

const reviseRow =
  document.getElementById('reviseRow');

const reviseInput =
  document.getElementById('reviseInput');

const blockRevised =
  document.getElementById('blockRevised');

const revisedQueryText =
  document.getElementById('revisedQueryText');

const blockError =
  document.getElementById('blockError');

const errorText =
  document.getElementById('errorText');

const btnYes =
  document.getElementById('btnYes');

const btnNo =
  document.getElementById('btnNo');

const btnRevise =
  document.getElementById('btnRevise');

const btnYes2 =
  document.getElementById('btnYes2');

const steps =
  [...document.querySelectorAll('.step')];

const emptyResults =
  document.getElementById('emptyResults');

const resultsArea =
  document.getElementById('resultsArea');


// ============================================================
// STATE
// ============================================================

let currentTranscript = '';
let currentSQL = '';

let requestInFlight = false;


// ============================================================
// FORMATTING
// ============================================================

function formatHeader(col) {

  return col
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}


function formatValue(v) {

  if (typeof v === 'number') {
    return v.toLocaleString('en-IN');
  }

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


  statusText.textContent =
    map[state] || state;


  statusPill.classList.toggle(
    'live',
    state !== 'idle'
  );
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

    step.classList.remove(
      'done',
      'doing'
    );

  });


  emptyResults.style.display = 'block';


  resultsArea
    .querySelectorAll(
      'table, .results-meta'
    )
    .forEach(el => el.remove());


  btnYes.disabled = false;

  btnNo.disabled = false;
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

  if (requestInFlight) {
    return;
  }


  requestInFlight = true;


  document
    .querySelectorAll('.chip')
    .forEach(chip => {
      chip.disabled = true;
    });


  resetForNewQuery();


  currentTranscript = transcript;


  transcriptText.textContent =
    transcript;


  blockTranscript.classList.add('show');


  setStatus('understood');


  micHint.textContent =
    'Thinking…';


  try {

    const result = await postJSON(
      '/generate-query/',
      {
        transcript
      }
    );


    currentSQL = result.sql;


    queryText.textContent =
      result.sql;


    explainText.textContent =
      result.explanation || '';


    blockQuery.classList.add(
      'show'
    );


    setStatus('waiting');


    /*
      Gemini has just been called.

      Ask Django for the latest usage count
      so the gauge updates without refreshing.
    */

    await loadUsageMeter();


  } catch (err) {

    showError(err.message);

  } finally {

    requestInFlight = false;


    micHint.textContent =
      'Tap the mic and ask something about the tables on the right.';


    document
      .querySelectorAll('.chip')
      .forEach(chip => {
        chip.disabled = false;
      });
  }
}


// ============================================================
// SAMPLE QUESTIONS
// ============================================================

document
  .querySelectorAll('.chip')
  .forEach(chip => {

    chip.addEventListener(
      'click',
      () => {
        handleTranscript(
          chip.dataset.q
        );
      }
    );

  });


// ============================================================
// VOICE CAPTURE
// ============================================================

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;


if (!SpeechRecognition) {

  // Browser doesn't support voice recognition.

  micBtn.style.display = 'none';

  fallbackRow.style.display = 'flex';

  micHint.textContent =
    'Voice capture isn\'t supported in this browser — type your question instead.';

} else {

  const recognition =
    new SpeechRecognition();


  recognition.lang =
    'en-IN';


  recognition.interimResults =
    false;


  micBtn.addEventListener(
    'click',
    () => {

      micBtn.classList.add(
        'active'
      );


      wave.classList.add(
        'active'
      );


      micHint.textContent =
        'Listening…';


      setStatus(
        'listening'
      );


      recognition.start();

    }
  );


  recognition.onresult =
    (event) => {

      const transcript =
        event.results[0][0]
          .transcript;


      handleTranscript(
        transcript
      );

    };


  recognition.onerror =
    () => {

      showError(
        'Could not capture voice. Try again or type instead.'
      );

    };


  recognition.onend =
    () => {

      micBtn.classList.remove(
        'active'
      );


      wave.classList.remove(
        'active'
      );


      micHint.textContent =
        'Tap the mic and ask something about the tables on the right.';

    };

}


// ============================================================
// TEXT FALLBACK
// ============================================================

fallbackSend.addEventListener(
  'click',
  () => {

    const text =
      fallbackInput.value.trim();


    if (text) {

      handleTranscript(
        text
      );

    }

  }
);


// Allow Enter key in text input.

fallbackInput.addEventListener(
  'keydown',
  event => {

    if (event.key === 'Enter') {

      const text =
        fallbackInput.value.trim();


      if (text) {

        handleTranscript(
          text
        );

      }

    }

  }
);


// ============================================================
// CONFIRM / DENY / REVISE
// ============================================================

btnNo.addEventListener(
  'click',
  () => {

    confirmRow.style.display =
      'none';


    reviseRow.style.display =
      'flex';


    reviseInput.value =
      '';


    reviseInput.focus();

  }
);


btnRevise.addEventListener(
  'click',
  async () => {

    const correction =
      reviseInput.value.trim();


    if (!correction) {
      return;
    }


    try {

      const result =
        await postJSON(
          '/revise-query/',
          {
            previous_sql:
              currentSQL,

            correction
          }
        );


      currentSQL =
        result.sql;


      revisedQueryText.textContent =
        result.sql;


      reviseRow.style.display =
        'none';


      blockRevised.classList.add(
        'show'
      );


      /*
        Revising also calls Gemini,
        so update the usage meter.
      */

      await loadUsageMeter();


    } catch (err) {

      showError(
        err.message
      );

    }

  }
);


btnYes.addEventListener(
  'click',
  () => runQuery('')
);


btnYes2.addEventListener(
  'click',
  () => runQuery(
    reviseInput.value.trim()
  )
);


// ============================================================
// RUN DATABASE QUERY
// ============================================================

async function runQuery(correction) {

  btnYes.disabled = true;

  btnNo.disabled = true;


  setStatus(
    'running'
  );


  steps.forEach(step => {

    step.classList.remove(
      'done',
      'doing'
    );

  });


  let i = 0;


  const stepTimer =
    setInterval(
      () => {

        if (i > 0) {

          steps[i - 1]
            .classList.remove(
              'doing'
            );


          steps[i - 1]
            .classList.add(
              'done'
            );

        }


        if (i < steps.length) {

          steps[i]
            .classList.add(
              'doing'
            );


          i++;

        } else {

          clearInterval(
            stepTimer
          );

        }

      },
      350
    );


  try {

    const result =
      await postJSON(
        '/run-query/',
        {
          sql: currentSQL,

          transcript:
            currentTranscript,

          correction
        }
      );


    setTimeout(
      () => {

        steps.forEach(
          step => {

            step.classList.remove(
              'doing'
            );


            step.classList.add(
              'done'
            );

          }
        );


        showResults(
          result.columns,
          result.rows
        );


        setStatus(
          'done'
        );

      },
      steps.length * 350 + 100
    );


  } catch (err) {

    clearInterval(
      stepTimer
    );


    showError(
      err.message
    );

  }

}


// ============================================================
// SHOW RESULTS
// ============================================================

function showResults(columns, rows) {

  emptyResults.style.display =
    'none';


  const table =
    document.createElement(
      'table'
    );


  table.className =
    'results';


  table.innerHTML = `

    <thead>

      <tr>

        ${columns
          .map(
            c =>
              `<th>${formatHeader(c)}</th>`
          )
          .join('')}

      </tr>

    </thead>


    <tbody>

      ${rows
        .map(
          row => `

            <tr>

              ${row
                .map(
                  value =>
                    `<td>${formatValue(value)}</td>`
                )
                .join('')}

            </tr>

          `
        )
        .join('')}

    </tbody>

  `;


  resultsArea.appendChild(
    table
  );


  const meta =
    document.createElement(
      'div'
    );


  meta.className =
    'results-meta';


  meta.innerHTML =
    `<span>${rows.length} rows</span>`;


  resultsArea.appendChild(
    meta
  );
}


// ============================================================
// COPY SQL
// ============================================================

document
  .getElementById('copyBtn')
  .addEventListener(
    'click',
    () => {

      navigator.clipboard.writeText(
        currentSQL
      );


      const btn =
        document.getElementById(
          'copyBtn'
        );


      btn.textContent =
        'Copied';


      setTimeout(
        () => {

          btn.textContent =
            'Copy';

        },
        1200
      );

    }
  );