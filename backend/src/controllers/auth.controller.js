const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../database/db');
const AppError = require('../utils/AppError');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;

// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertUser = db.prepare(
  'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)'
);

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

async function register(req, res, next) {
  try {
    const { name, email, password } = req.body || {};

    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      throw new AppError(400, 'INVALID_NAME', 'Name must be between 2 and 80 characters.');
    }
    if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email.trim())) {
      throw new AppError(400, 'INVALID_EMAIL', 'Please enter a valid email address.');
    }
    if (
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 128 ||
      !/[A-Za-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      throw new AppError(
        400,
        'WEAK_PASSWORD',
        'Password must be 8-128 characters and contain at least one letter and one number.'
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    if (findByEmail.get(cleanEmail)) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const info = insertUser.run(name.trim(), cleanEmail, hash);
    const user = { id: Number(info.lastInsertRowid), name: name.trim(), email: cleanEmail };

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new AppError(400, 'MISSING_CREDENTIALS', 'Email and password are required.');
    }

    const user = findByEmail.get(email.trim().toLowerCase());
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !ok) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { register, login, me };