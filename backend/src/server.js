const fs = require('fs');
const path = require('path');
const config = require('./config');

const PLACEHOLDER_SECRET = 'change-this-to-a-long-random-string';
if (!config.jwtSecret || config.jwtSecret === PLACEHOLDER_SECRET || config.jwtSecret.length < 16) {
  console.error('\n[ERROR] JWT_SECRET is missing or still the placeholder value.');
  console.error('        Run scripts\\setup.bat (it generates one), or set a long random');
  console.error('        JWT_SECRET in backend/.env, then start again.\n');
  process.exit(1);
}

const app = require('./app');
const { db } = require('./database/db');

fs.mkdirSync(config.uploadDir, { recursive: true });

// Remove leftover uploads older than 1 hour (e.g. after a crash).
function cleanupStaleUploads() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const name of fs.readdirSync(config.uploadDir)) {
    const full = path.join(config.uploadDir, name);
    try {
      const st = fs.statSync(full);
      if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(full);
    } catch (err) {
      /* ignore */
    }
  }
}
cleanupStaleUploads();

// Analyses interrupted by a restart can never finish - mark them as failed.
db.prepare(
  `UPDATE assessments
      SET status = 'failed', error_code = 'SERVER_RESTARTED',
          error_message = 'The server restarted while this video was being analysed.',
          completed_at = datetime('now')
    WHERE status = 'processing'`
).run();

const server = app.listen(config.port, () => {
  console.log('\n==============================================');
  console.log(' AI Sports Talent Assessment - Backend');
  console.log(` API:      http://localhost:${config.port}/api`);
  console.log(` Health:   http://localhost:${config.port}/api/health`);
  console.log(` Database: ${config.databasePath}`);
  console.log(` Python:   ${config.pythonPath}`);
  console.log(` AI coach: ${config.geminiApiKey ? `on (${config.geminiModel})` : 'off (no GEMINI_API_KEY)'}`);  console.log('==============================================\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${config.port} is already in use.`);
    console.error('        Close the other program, or change PORT in backend/.env.\n');
  } else {
    console.error('[ERROR] Server failed to start:', err);
  }
  process.exit(1);
});

function shutdown() {
  console.log('\nShutting down...');
  server.close(() => {
    try {
      db.close();
    } catch (err) {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);