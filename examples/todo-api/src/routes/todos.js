import { Router } from 'express';
import { store } from '../store.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateCreate, validateUpdate } from '../middleware/validate.js';

const router = Router();

// GET /api/todos?done=true
router.get('/', (req, res) => {
  const { done } = req.query;
  const filter = done === undefined ? {} : { done: done === 'true' };
  res.json(store.all(filter));
});

// GET /api/todos/:id
router.get('/:id', (req, res, next) => {
  const todo = store.find(req.params.id);
  if (!todo) return next(new HttpError(404, 'todo not found'));
  res.json(todo);
});

// POST /api/todos
router.post('/', validateCreate, async (req, res, next) => {
  try {
    const todo = await store.create({ title: req.body.title });
    res.status(201).json(todo);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/todos/:id
router.patch('/:id', validateUpdate, async (req, res, next) => {
  try {
    const todo = await store.update(req.params.id, req.patch);
    if (!todo) return next(new HttpError(404, 'todo not found'));
    res.json(todo);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/todos/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const removed = await store.remove(req.params.id);
    if (!removed) return next(new HttpError(404, 'todo not found'));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
