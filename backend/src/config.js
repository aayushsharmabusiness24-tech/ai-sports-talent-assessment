const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(backendRoot, '..');

dotenv.config({ path: path.join(backendRoot, '.env') });

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveFromBackend(value, fallback) {
  const v = value && value.trim() ? value.trim() : fallback;
  return path.isAbsolute(v) ? v : path.resolve(backendRoot, v);
}

function defaultPython() {
  const win = path.join(projectRoot, 'ai', 'venv', 'Scripts', 'python.exe');
  const nix = path.join(projectRoot, 'ai', 'venv', 'bin', 'python');
  if (fs.existsSync(win)) return win;
  if (fs.existsSync(nix)) return nix;
  return process.platform === 'win32' ? 'python' : 'python3';
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: positiveNumber(process.env.PORT, 5000),
  frontendOrigins: (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
  geminiModel: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
  geminiFallbackModel: (process.env.GEMINI_FALLBACK_MODEL || '').trim(),
  coachTimeoutMs: positiveNumber(process.env.COACH_TIMEOUT_SECONDS, 30) * 1000,
  maxUploadMb: positiveNumber(process.env.MAX_UPLOAD_MB, 100),
  aiTimeoutMs: positiveNumber(process.env.AI_TIMEOUT_SECONDS, 300) * 1000,
  databasePath: resolveFromBackend(process.env.DATABASE_PATH, '../storage/assessments.db'),
  uploadDir: resolveFromBackend(process.env.UPLOAD_DIR, '../storage/uploads'),
  backendRoot,
  projectRoot,
  aiDir: path.join(projectRoot, 'ai'),
  aiEntry: path.join(projectRoot, 'ai', 'main.py'),
  // Getter so the venv is detected at call time (it may be created after first load).
  get pythonPath() {
    const fromEnv = (process.env.PYTHON_PATH || '').trim();
    return fromEnv || defaultPython();
  },
};

module.exports = config;