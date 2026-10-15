const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const AppError = require('../utils/AppError');

const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      fs.mkdirSync(config.uploadDir, { recursive: true });
      cb(null, config.uploadDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // Random server-side name: the user's filename is never used as a path.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk =
    file.mimetype.startsWith('video/') || file.mimetype === 'application/octet-stream';

  if (!ALLOWED_EXTENSIONS.includes(ext) || !mimeOk) {
    return cb(
      new AppError(
        400,
        'INVALID_FILE_TYPE',
        `Unsupported file type. Allowed video formats: ${ALLOWED_EXTENSIONS.join(', ')}.`
      )
    );
  }
  return cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

module.exports = {
  uploadVideo: upload.single('video'),
  ALLOWED_EXTENSIONS,
};