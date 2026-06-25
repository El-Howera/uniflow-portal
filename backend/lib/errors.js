class AppError extends Error {
  // `details` is optional structured data — for Zod validation we surface
  // field-level errors so the client can highlight specific inputs.
  constructor(message, status = 500, details = null) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = 'AppError';
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  if (status >= 500) {
    console.error('[error]', req.method, req.path, err);
  }
  const body = { error: message };
  if (err.details) body.details = err.details;
  res.status(status).json(body);
}

module.exports = { AppError, asyncHandler, errorHandler };
