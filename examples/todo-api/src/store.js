import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'todos.json');

// In-memory cache of every todo. The JSON file on disk is the source of truth,
// but we only read it once at boot and write it back after each change.
let todos = [];
let writeQueue = Promise.resolve();

async function persist() {
  // Chain writes so two rapid requests can never interleave and corrupt the file.
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(todos, null, 2), 'utf8');
  });
  return writeQueue;
}

export const store = {
  async load() {
    try {
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      todos = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      todos = [];            // first run: no file yet, start empty
      await persist();
    }
    return todos;
  },

  all({ done } = {}) {
    if (done === undefined) return todos;
    return todos.filter((todo) => todo.done === done);
  },

  find(id) {
    return todos.find((todo) => todo.id === id);
  },

  async create({ title }) {
    const todo = {
      id: randomUUID(),
      title,
      done: false,
      createdAt: new Date().toISOString(),
    };
    todos.push(todo);
    await persist();
    return todo;
  },

  async update(id, patch) {
    const todo = store.find(id);
    if (!todo) return null;
    // Only copy over the fields the caller actually sent.
    if (patch.title !== undefined) todo.title = patch.title;
    if (patch.done !== undefined) todo.done = patch.done;
    todo.updatedAt = new Date().toISOString();
    await persist();
    return todo;
  },

  async remove(id) {
    const index = todos.findIndex((todo) => todo.id === id);
    if (index === -1) return false;
    todos.splice(index, 1);
    await persist();
    return true;
  },
};
