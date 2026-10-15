const multer = require('multer');
const AppError = require('../utils/AppError');
const config = require('../config');

function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on the server. Please try again.';

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
  } else if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      code = 'FILE_TOO_LARGE';
      message = `The video is larger than the ${config.maxUploadMb} MB limit.`;
    } else {
      status = 400;
      code = 'UPLOAD_ERROR';
      message = `Upload failed: ${err.message}. Make sure you attach exactly one video in the "video" field.`;
    }
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'The request body is not valid JSON.';
  } else if (err && err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'The request body is too large.';
  } else if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_')) {
    status = 500;
    code = 'DATABASE_ERROR';
    message = 'A database error occurred. Please try again.';
    console.error('[db]', err);
  } else {
    console.error('[error]', err);
  }

  if (res.headersSent) return next(err);

  const body = { error: { code, message } };
  if (err && err.assessmentId) body.assessmentId = err.assessmentId;
  return res.status(status).json(body);
}

module.exports = { notFound, errorHandler };