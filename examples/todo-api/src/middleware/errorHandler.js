// A small Error subclass that carries an HTTP status code with it.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Runs when no route matched the request.
export function notFound(req, res, next) {
  next(new HttpError(404, `No route for ${req.method} ${req.originalUrl}`));
}

// Express recognises this as the error handler because it takes FOUR arguments.
// Every next(err) anywhere in the app ends up here.
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    details: err.details,
  });
}
