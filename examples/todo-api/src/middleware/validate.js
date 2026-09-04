import { HttpError } from './errorHandler.js';

const MAX_TITLE_LENGTH = 200;

function cleanTitle(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) return null;
  return trimmed;
}

// Guards POST /api/todos — a new todo must have a usable title.
export function validateCreate(req, res, next) {
  const title = cleanTitle(req.body?.title);
  if (title === null) {
    return next(new HttpError(400, 'title is required', {
      field: 'title',
      rule: `non-empty string, at most ${MAX_TITLE_LENGTH} characters`,
    }));
  }
  req.body.title = title;
  next();
}

// Guards PATCH /api/todos/:id — at least one known field, and each must be valid.
export function validateUpdate(req, res, next) {
  const patch = {};

  if (req.body?.title !== undefined) {
    const title = cleanTitle(req.body.title);
    if (title === null) return next(new HttpError(400, 'title must be a non-empty string'));
    patch.title = title;
  }

  if (req.body?.done !== undefined) {
    if (typeof req.body.done !== 'boolean') {
      return next(new HttpError(400, 'done must be true or false'));
    }
    patch.done = req.body.done;
  }

  if (Object.keys(patch).length === 0) {
    return next(new HttpError(400, 'nothing to update: send title and/or done'));
  }

  req.patch = patch;
  next();
}
