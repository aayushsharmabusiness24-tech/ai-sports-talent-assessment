const { spawn, spawnSync } = require('child_process');
const config = require('../config');
const AppError = require('../utils/AppError');

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

// Maps error codes returned by the Python service to HTTP statuses.
const PYTHON_ERROR_STATUS = {
  MODEL_MISSING: 503,
  DEPENDENCY_MISSING: 503,
  UNSUPPORTED_ACTIVITY: 400,
  VIDEO_UNREADABLE: 422,
  VIDEO_TOO_SHORT: 422,
  NO_PERSON: 422,
  MULTIPLE_PEOPLE: 422,
  INTERNAL: 500,
};

function killTree(child) {
  try {
    if (process.platform === 'win32') {
      // The venv python.exe can spawn a child; kill the whole tree.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGKILL');
    }
  } catch (err) {
    /* ignore */
  }
}

function runPython(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(config.pythonPath, [config.aiEntry, ...args], {
        cwd: config.aiDir,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
          TF_CPP_MIN_LOG_LEVEL: '2',
          GLOG_minloglevel: '2',
        },
      });
    } catch (err) {
      return reject(pythonUnavailable());
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let tooMuchOutput = false;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
      if (stdout.length > MAX_OUTPUT_BYTES) {
        tooMuchOutput = true;
        killTree(child);
      }
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d.toString('utf8')).slice(-8000);
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') return finish(reject, pythonUnavailable());
      return finish(
        reject,
        new AppError(500, 'AI_START_FAILED', `Could not start the AI service: ${err.message}`)
      );
    });

    child.on('close', (code) => {
      if (timedOut) {
        return finish(
          reject,
          new AppError(
            504,
            'AI_TIMEOUT',
            `The video analysis took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped. Try a shorter video.`
          )
        );
      }
      if (tooMuchOutput) {
        return finish(reject, new AppError(502, 'AI_FAILURE', 'The AI service returned too much data.'));
      }
      return finish(resolve, { code, stdout, stderr });
    });
  });
}

function pythonUnavailable() {
  return new AppError(
    503,
    'PYTHON_UNAVAILABLE',
    'Python was not found. Run scripts\\setup.bat to create the AI environment, or set PYTHON_PATH in backend/.env.'
  );
}

// The Python service logs to stderr and prints exactly one JSON line to stdout.
function parseJsonOutput({ stdout, stderr, code }) {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const jsonLine = [...lines].reverse().find((l) => l.startsWith('{'));

  if (!jsonLine) {
    console.error('[ai] No JSON output. exit code:', code, '\n', stderr);
    if (!stdout.trim()) {
      throw new AppError(502, 'AI_EMPTY_RESULT', 'The AI service returned an empty result.');
    }
    throw new AppError(502, 'AI_FAILURE', 'The AI service returned an unreadable result.');
  }

  try {
    return JSON.parse(jsonLine);
  } catch (err) {
    console.error('[ai] Invalid JSON:', err.message, '\n', stderr);
    throw new AppError(502, 'AI_FAILURE', 'The AI service returned invalid data.');
  }
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

// Validates the structure returned by Python and fills safe defaults.
function normaliseAnalysis(raw, activity) {
  if (!raw || typeof raw !== 'object') {
    throw new AppError(502, 'AI_EMPTY_RESULT', 'The AI service returned an empty result.');
  }

  if (raw.ok === false) {
    const err = raw.error || {};
    const code = typeof err.code === 'string' ? err.code : 'INTERNAL';
    const status = PYTHON_ERROR_STATUS[code] || 500;
    throw new AppError(status, code, err.message || 'The video could not be analysed.');
  }

  if (raw.ok !== true) {
    throw new AppError(502, 'AI_FAILURE', 'The AI service returned an unexpected response.');
  }
  if (!['completed', 'insufficient_data'].includes(raw.status)) {
    throw new AppError(502, 'AI_FAILURE', 'The AI service returned an unknown status.');
  }
  if (raw.activity !== activity) {
    throw new AppError(502, 'AI_FAILURE', 'The AI service analysed a different activity than requested.');
  }

  let formScore = null;
  if (raw.formScore !== null && raw.formScore !== undefined) {
    formScore = Number(raw.formScore);
    if (!Number.isFinite(formScore) || formScore < 0 || formScore > 100) {
      throw new AppError(502, 'AI_FAILURE', 'The AI service returned an invalid score.');
    }
  }
  if (raw.status === 'completed' && formScore === null) {
    throw new AppError(502, 'AI_FAILURE', 'The AI service completed without a score.');
  }
  if (raw.status === 'insufficient_data') formScore = null; // never keep a fabricated score

  const toCount = (v) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };

  const conf = raw.confidence && typeof raw.confidence === 'object' ? raw.confidence : {};
  const metrics = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : {};

  return {
    ok: true,
    status: raw.status,
    activity: raw.activity,
    activityLabel: String(raw.activityLabel || activity),
    cameraView: String(raw.cameraView || 'auto'),
    repetitions: toCount(raw.repetitions),
    incompleteRepetitions: toCount(raw.incompleteRepetitions),
    formScore,
    scoreBreakdown: asArray(raw.scoreBreakdown),
    feedback: asArray(raw.feedback).map(String),
    mistakes: asArray(raw.mistakes),
    suggestions: asArray(raw.suggestions).map(String),
    summary: String(raw.summary || ''),
    confidence: {
      overall: Number.isFinite(Number(conf.overall)) ? Number(conf.overall) : 0,
      warnings: asArray(conf.warnings).map(String),
    },
    metrics: {
      measured: metrics.measured && typeof metrics.measured === 'object' ? metrics.measured : {},
      estimated: metrics.estimated && typeof metrics.estimated === 'object' ? metrics.estimated : {},
    },
    video: raw.video && typeof raw.video === 'object' ? raw.video : {},
    disclaimer: String(
      raw.disclaimer ||
        'Experimental computer-vision estimate. Not a certified sports assessment or medical advice.'
    ),
  };
}

async function analyzeVideo({ videoPath, activity, cameraView }) {
  const output = await runPython(
    ['--video', videoPath, '--activity', activity, '--view', cameraView || 'auto'],
    config.aiTimeoutMs
  );
  const raw = parseJsonOutput(output);
  return normaliseAnalysis(raw, activity);
}

// ---- Health check (cached briefly because importing MediaPipe is slow) ----
let cachedHealth = null;
let cachedAt = 0;

async function checkAiService() {
  if (cachedHealth && Date.now() - cachedAt < 30000) return cachedHealth;

  let result;
  try {
    const output = await runPython(['--check'], 40000);
    const parsed = parseJsonOutput(output);
    result = { ...parsed, pythonFound: true, ok: parsed.ok === true };
  } catch (err) {
    result = {
      ok: false,
      pythonFound: err.code !== 'PYTHON_UNAVAILABLE',
      problems: [err.message],
    };
  }

  cachedHealth = result;
  cachedAt = Date.now();
  return result;
}

module.exports = { analyzeVideo, checkAiService };