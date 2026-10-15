// An error that carries an HTTP status and a machine-readable code.
class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

module.exports = AppError;