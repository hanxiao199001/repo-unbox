import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import todosRouter from './routes/todos.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { store } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

// Parse incoming JSON request bodies into req.body
app.use(express.json());

// Log every request: method, path, and how long it took
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - startedAt;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Serve the browser client from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount the todo routes under /api/todos
app.use('/api/todos', todosRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', count: store.all().length, uptime: process.uptime() });
});

app.use(notFound);
app.use(errorHandler);

await store.load();

app.listen(PORT, () => {
  console.log(`todo-api listening on http://localhost:${PORT}`);
});
