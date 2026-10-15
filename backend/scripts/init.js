// Prepares the backend: creates backend/.env (with a random JWT secret),
// creates storage folders, and initialises the SQLite database.
// Run automatically by scripts\setup.bat. Safe to run again.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const backendRoot = path.resolve(__dirname, '..');
const envPath = path.join(backendRoot, '.env');
const examplePath = path.join(backendRoot, '.env.example');

if (!fs.existsSync(envPath)) {
  const secret = crypto.randomBytes(48).toString('hex');
  const text = fs
    .readFileSync(examplePath, 'utf8')
    .replace('JWT_SECRET=change-this-to-a-long-random-string', `JWT_SECRET=${secret}`);
  fs.writeFileSync(envPath, text);
  console.log('Created backend/.env with a new random JWT_SECRET.');
} else {
  console.log('backend/.env already exists - leaving it unchanged.');
}

// Load config only AFTER .env exists so dotenv can read it.
const config = require('../src/config');

fs.mkdirSync(config.uploadDir, { recursive: true });
console.log('Upload folder ready:', config.uploadDir);

const { db, checkDatabase } = require('../src/database/db');
const status = checkDatabase();
if (!status.ok) {
  console.error('Database check failed:', status.error);
  process.exit(1);
}
console.log('Database ready:', config.databasePath);
db.close();