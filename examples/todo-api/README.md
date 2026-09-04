# todo-api

A minimal todo list service: an Express JSON API plus a single-page browser client.

- `GET    /api/todos`      list todos (supports `?done=true|false`)
- `POST   /api/todos`      create a todo `{ "title": "buy milk" }`
- `PATCH  /api/todos/:id`  update `title` and/or `done`
- `DELETE /api/todos/:id`  remove a todo

Data lives in `data/todos.json` on disk. Start it with `npm start`, then open
http://localhost:3000.
