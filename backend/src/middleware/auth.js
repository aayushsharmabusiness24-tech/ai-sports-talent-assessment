const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../database/db');
const AppError = require('../utils/AppError');

const findUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'AUTH_REQUIRED', 'Please log in to continue.'));
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = findUser.get(payload.sub);
    if (!user) throw new Error('user not found');
    req.user = user;
    return next();
  } catch (err) {
    return next(new AppError(401, 'AUTH_INVALID', 'Your session has expired. Please log in again.'));
  }
}

module.exports = { authenticate };