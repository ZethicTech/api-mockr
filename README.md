# mockr

A local mock API server you configure in a browser and extend with plain
JavaScript. No database, no account, no cloud.

```bash
cd your-project
npx mockrjs
```

That scaffolds a project, starts a mock server on `:4000` and opens a UI on
`:4100`. Anything you save in the UI is live on the next request.

```
  mockr  3 route(s)

  ● mock   http://127.0.0.1:4000
  ● ui     http://127.0.0.1:4100
```

---

## Why

You need an API that does not exist yet, or one that exists but will not
return the failure you are trying to handle. Mockr gives you both:

- **Static routes** for the ordinary case — a method, a path, a JSON body.
- **JavaScript handlers** when the response has to be computed, and
  **interceptors** when the request or response has to be transformed —
  decryption, encryption, validation, simulated auth.

Everything lives in files in your repo, so it is reviewable and committable
like the rest of your project.

---

## Using it in your project

### 1. Start it

Add it to your dev scripts so it comes up with everything else:

```json
{
  "devDependencies": { "mockrjs": "^0.1.0" },
  "scripts": {
    "mock": "mockr",
    "dev": "npm run mock & vite"
  }
}
```

Or run it on demand with `npx mockrjs`. No install required.

> The package is `mockrjs`; the command it installs is `mockr`.

### 2. Point your app at it

```diff
- VITE_API_URL=https://api.example.com
+ VITE_API_URL=http://localhost:4000
```

CORS is permissive by default and preflight is answered automatically, so a
browser app on any port can call it without configuration.

### 3. Create routes

Open `http://localhost:4100`, click **New route**, fill in a method, a path
and a body, and save. The endpoint answers immediately — no restart, no build.

Everything the UI does is written to `mockr.json` in your project, so you can
also skip the UI entirely and edit that file by hand. Both directions hot
reload, and the UI notices external edits within two seconds.

### 4. Commit it

```
mockr.json          the routes
handlers/           JavaScript route handlers
interceptors/       request and response transforms
```

Commit all three and your team gets the same mocks.

---

## Routes

### Static

The common case. Configure it in the UI, or write it directly:

```json
{
  "method": "GET",
  "path": "/users",
  "response": {
    "status": 200,
    "body": { "users": [] }
  }
}
```

### Path parameters

```json
{
  "method": "GET",
  "path": "/users/:id",
  "response": { "status": 200, "body": { "id": 1 } }
}
```

Static segments win over parameters, so `/users/me` beats `/users/:id`
regardless of the order they appear in.

### Slow and failing responses

```json
{
  "method": "POST",
  "path": "/checkout",
  "response": {
    "status": 503,
    "delayMs": 3000,
    "body": { "error": "service unavailable" }
  }
}
```

This is the reason most people reach for a mock server: reproducing the
timeout or the 500 that is awkward to trigger against a real backend.

### Custom headers

```json
{
  "method": "GET",
  "path": "/download",
  "response": {
    "status": 200,
    "headers": { "content-type": "text/csv" },
    "body": "id,name\n1,Ada"
  }
}
```

---

## Handlers

Write these in the UI's **Code** tab, or in your own editor — both hot reload,
and the UI picks up external edits within two seconds.

When the response depends on the request, point the route at a file instead
of a body:

```json
{ "method": "POST", "path": "/login", "handler": "login" }
```

```js
// handlers/login.js
module.exports = async function (ctx) {
  const { email, password } = ctx.request.body;

  if (password !== 'hunter2') {
    const err = new Error('invalid credentials');
    err.status = 401;
    err.body = { error: 'invalid credentials' };
    throw err;
  }

  return {
    status: 200,
    body: { token: 'abc123', email },
  };
};
```

A route has either a `response` or a `handler`, never both.

In the UI, choosing **JavaScript handler** on a route gives you a dropdown of
what exists and an **Edit code →** link into the editor. New files start from
a template. Code that does not parse is refused on save, so a typo can never
replace a handler that was working.

### Using npm packages

Handlers and interceptors are ordinary Node modules, so they can require
anything installed **in your own project**. Install it the normal way:

```bash
npm install jsonwebtoken
```

Then require it. Nothing to register, no config:

```js
// interceptors/requireAuth.js
const jwt = require('jsonwebtoken');

const SECRET = process.env.MOCK_JWT_SECRET || 'dev-secret';

module.exports = async function (ctx) {
  const header = ctx.request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    ctx.response = { status: 401, headers: {}, body: { error: 'missing bearer token' } };
    return;
  }

  try {
    // Anything you attach to ctx is visible to the handler that runs next.
    ctx.request.user = jwt.verify(token, SECRET);
  } catch (err) {
    ctx.response = { status: 401, headers: {}, body: { error: err.message } };
  }
};
```

Attach it to any route that should require a token:

```json
{
  "method": "GET",
  "path": "/me",
  "handler": "me",
  "request": { "interceptors": ["requireAuth"] }
}
```

And the handler reads what the interceptor left behind:

```js
// handlers/me.js
module.exports = async function (ctx) {
  return { body: { id: ctx.request.user.sub, email: ctx.request.user.email } };
};
```

Environment variables work as usual, so secrets stay out of the repo:

```bash
MOCK_JWT_SECRET=something-else npx mockrjs
```

**If you forget to install the package**, the route returns an error naming the
missing module and the UI shows it. Installing it fixes things on the next
request — no restart, and no need to touch the file, because a failed load is
never cached.

Mockr installs nothing on your behalf and bundles nothing.

### What a handler receives

```js
ctx.request.method    // "POST"
ctx.request.path      // "/users/42"
ctx.request.params    // { id: "42" }        from /users/:id
ctx.request.query     // { page: "2" }       from ?page=2
ctx.request.headers   // lowercased keys
ctx.request.body      // parsed by content-type
ctx.route.id          // the route that matched
```

### What a handler returns

```js
return { status: 200, headers: {}, body: {} };
```

All three are optional. `status` defaults to `200`, and returning nothing at
all produces a `204`.

To fail with a specific status, throw an error carrying one:

```js
const err = new Error('not found');
err.status = 404;
err.body = { error: 'not found' };
throw err;
```

An unexpected throw becomes a `500` naming the handler, and the stack is
printed to the terminal.

---

## Interceptors

Interceptors are written the same way — the Code tab, or your editor — and are
attached per route, so one implementation can serve many endpoints:

```json
{
  "method": "POST",
  "path": "/payment",
  "request": { "interceptors": ["decrypt", "validate"] },
  "response": {
    "status": 200,
    "body": { "ok": true },
    "interceptors": ["encrypt"]
  }
}
```

Interceptors **mutate `ctx`**. Return values are ignored.

```js
// interceptors/decrypt.js
module.exports = async function (ctx) {
  ctx.request.body = JSON.parse(decrypt(ctx.request.body.payload));
};
```

```js
// interceptors/encrypt.js
module.exports = async function (ctx) {
  ctx.response.body = { payload: encrypt(JSON.stringify(ctx.response.body)) };
};
```

`ctx.response` exists only in the response phase. During the request phase it
is `undefined`, because the response has not been produced yet.

### Simulating auth

Setting `ctx.response` during the request phase ends the request early — the
handler and any remaining request interceptors are skipped:

```js
// interceptors/requireAuth.js
module.exports = async function (ctx) {
  if (!ctx.request.headers.authorization) {
    ctx.response = { status: 401, headers: {}, body: { error: 'unauthorized' } };
  }
};
```

### Validating input

```js
// interceptors/validate.js
module.exports = async function (ctx) {
  if (!ctx.request.body.email) throw new Error('email is required');
};
```

A throw in a request interceptor is a `400` carrying your message. A throw in
a response interceptor is a `500`, because by then the request was already
accepted and the failure is the server's.

---

## The order things run

```
request → route lookup → request interceptors → handler or static response
        → response interceptors → delay → response
```

---

## Hot reload

Editing `mockr.json`, any handler, or any interceptor takes effect on the next
request. The server is never restarted.

If you save something broken — invalid JSON, a syntax error in a handler —
Mockr keeps serving the last working configuration and shows the error in the
UI and the terminal. It does not crash and it does not start returning 404s
for routes you did not touch.

---

## CommonJS, and ESM projects

Handlers and interceptors are **CommonJS** (`module.exports`). This is not
stylistic: hot reload needs to drop modules from Node's require cache, and the
ESM loader has no equivalent. Supporting `import` would mean losing reload,
which is the feature you would be using them for.

If your project has `"type": "module"` in `package.json`, plain `.js` files are
ESM and cannot use `module.exports`. Mockr detects this and scaffolds `.cjs`
instead:

```
handlers/login.cjs
interceptors/requireAuth.cjs
```

Both extensions work everywhere, and routes still reference them without one
(`"handler": "login"`). If you hand-write a `.js` file in an ESM project, the
error tells you exactly which file to rename.

---

## Ports and settings

Both ports are configurable, either per run or per project.

### On the command line

```bash
npx mockrjs --port 4000 --admin-port 4100
```

### In mockr.json

So the whole team gets the same ports without typing flags:

```json
{
  "server": {
    "port": 4000,
    "adminPort": 4100,
    "host": "127.0.0.1",
    "cors": true,
    "quiet": false
  },
  "routes": []
}
```

**Flags beat the file, and the file beats the defaults — per setting.** So
this keeps the file's `adminPort` and overrides only the mock port:

```bash
npx mockrjs --port 6001
```

```
  ● mock   http://127.0.0.1:6001  (flag)
  ● ui     http://127.0.0.1:5556  (file)
```

Saving routes from the UI never touches your `server` block.

`port`, `adminPort` and `host` are bound once at startup. Editing them while
Mockr is running prints a warning telling you to restart, rather than letting
the change look like it applied. Everything else hot reloads.

## CLI

```bash
mockr                    # start, scaffolding first if needed
mockr init               # scaffold only
```

| Flag | Default | |
|---|---|---|
| `-p, --port` | `4000` | mock server port |
| `--admin-port` | `4100` | UI and API port |
| `--host` | `127.0.0.1` | bind address |
| `-d, --dir` | cwd | project directory |
| `--cors` / `--no-cors` | on | permissive CORS |
| `-q, --quiet` | | silence the request log |

---

## Configuration reference

```ts
{
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  path: string                          // "/users/:id"

  request?: {
    interceptors?: string[]
  }

  // exactly one of response / handler
  response?: {
    status?: number                     // default 200
    delayMs?: number                    // default 0
    headers?: Record<string, string>
    body?: unknown                      // omit for 204
    interceptors?: string[]
  }
  handler?: string                      // "login" → handlers/login.js
}
```

`id` is added and managed by Mockr. You never need to write one.

---

## Management API

The UI is a client of this, and so can your scripts be. It runs on the admin
port.

```http
GET    /api/routes
GET    /api/routes/:id
POST   /api/routes
PUT    /api/routes/:id
DELETE /api/routes/:id

GET    /api/handlers          names available to route at
GET    /api/interceptors
GET    /api/status            route count, load errors

GET    /api/handlers/:name    read source
PUT    /api/handlers/:name    write source  { "source": "..." }
DELETE /api/handlers/:name
GET    /api/interceptors/:name
PUT    /api/interceptors/:name
DELETE /api/interceptors/:name
```

Module writes are parsed before they are saved and rejected with `422` if they
do not compile, so the running server keeps the last working version.

Writes are validated before they touch the file, and rejected ones come back
as `422` listing every problem at once.

---

## Two ports, on purpose

The mock server and the admin API are separate so that `/api/*` and `/` stay
yours to mock. With a single port those paths would be permanently reserved by
Mockr itself.

---

## Security

Mockr runs your handlers and interceptors as ordinary Node code, in process,
with no sandbox. The management API is unauthenticated. Both servers therefore
bind to `127.0.0.1`.

`--host 0.0.0.0` exposes arbitrary local code execution to your network. Only
do it on a network you trust.

---

## What it deliberately does not do

No regex or wildcard routes, request recording, response scenarios, OpenAPI
import, GraphQL, WebSockets, auth, multi-user, or a database.

It does not manage your dependencies. Handlers can require anything in your
project's `node_modules`, but installing them is yours to do.

There is also **no passthrough proxy**: a request that matches no route is a
`404`, not a forwarded call to a real backend. If only part of your API is
mocked, point the mocked calls at Mockr and leave the rest alone, or route
them with your dev server's own proxy rules.

---

## Development

```bash
npm install
npm run build
npm test
```

- `npm run build:server` — TypeScript to `dist/`
- `npm run build:ui` — Preact and Tailwind to `dist/ui/`
- `npm test` — unit and end-to-end tests, including reload

The architecture and the reasoning behind each decision are in
[`docs/spec.md`](docs/spec.md).

## License

MIT
