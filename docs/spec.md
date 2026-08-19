# Mockr - MVP Architecture & Product Specification

## Vision

Mockr is a lightweight local mock API server that allows developers to:

- Create mock APIs through a web UI
- Store configuration in JSON files
- Hot reload changes
- Return static JSON responses
- Execute custom JavaScript logic
- Run request and response interceptors

Core philosophy:

> Configure responses. Write custom logic when needed.

Mockr should remain lightweight, understandable, and self-hostable.

---

# Primary Use Cases

### Frontend Development

Create APIs before the backend exists.

### QA Testing

Simulate successful and failure responses.

### Integration Testing

Mock third-party services.

### Encrypted Payload Testing

Decrypt incoming payloads and encrypt responses using custom JavaScript.

### Validation Testing

Validate request payloads before returning responses.

---

# Trust Model

Mockr is a **local development tool**.

- Handlers and interceptors are arbitrary Node.js code, executed in-process, with full privileges
- There is no sandbox
- The management API is unauthenticated

Therefore:

```text
All servers bind to 127.0.0.1 by default
```

Binding to another interface requires an explicit flag:

```bash
mockr --host 0.0.0.0
```

Doing so exposes arbitrary local code execution paths to the network.
This is documented, not defended against.

---

# Module System

User code is **CommonJS only**.

```js
module.exports = async function (ctx) {};
```

Reason:

Hot reload requires cache invalidation.

```js
delete require.cache[require.resolve(file)];
```

ESM provides no cache invalidation API. The `import()` cache-busting
workaround leaks every version of every module for the lifetime of the
process.

Rules:

- The Mockr server itself is TypeScript compiled to CommonJS
- User handlers and interceptors are `.js`, CommonJS
- User `.ts` files are not supported in MVP (no transpile step for user code)

---

# Ports

Mockr runs two servers.

```text
Mock server    127.0.0.1:4000    user-defined routes
Admin server   127.0.0.1:4100    management API + web UI
```

Reason:

A single port forces a reserved path prefix, meaning users could never
mock `/api/*` or `/`. Two ports keep the mock surface completely clean.

Configurable:

```bash
mockr --port 4000 --admin-port 4100
```

---

# CORS

The mock server enables permissive CORS by default.

```text
Access-Control-Allow-Origin:      <request origin, or *>
Access-Control-Allow-Methods:     GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD
Access-Control-Allow-Headers:     <request's Access-Control-Request-Headers, or *>
Access-Control-Allow-Credentials: true
```

`OPTIONS` preflight is answered automatically by the runtime, before route
lookup, and never reaches user routes or interceptors.

Reason:

Frontend development is the primary use case. A browser app on `:5173`
calling mocks on `:4000` fails without this.

Disable with:

```bash
mockr --no-cors
```

---

# Project Structure

```text
project/

├── mockr.json
│
├── handlers/
│   ├── login.js
│   └── payment.js
│
├── interceptors/
│   ├── decrypt.js
│   ├── encrypt.js
│   └── validate.js
│
├── src/
│   ├── runtime/
│   ├── registry/
│   ├── storage/
│   ├── interceptors/
│   ├── handlers/
│   ├── http/
│   ├── api/
│   ├── cli/
│   └── ui/
│
└── package.json
```

---

# CLI

## Start

```bash
npx mockr
```

Flags:

```text
--port         mock server port         default 4000
--admin-port   admin + UI port          default 4100
--host         bind address             default 127.0.0.1
--dir          project directory        default cwd
--no-cors      disable CORS
--no-open      do not open the browser
```

## Init

```bash
npx mockr init
```

Creates:

```text
mockr.json          with one example route
handlers/
interceptors/
```

`mockr init` is idempotent — existing files are never overwritten.

If `mockr` starts in a directory with no `mockr.json`, it scaffolds one
automatically rather than failing.

---

# Configuration File

## mockr.json

```json
{
  "routes": [
    {
      "id": "r_8f3a1c",

      "method": "POST",
      "path": "/login",

      "request": {
        "interceptors": ["decrypt", "validate"]
      },

      "response": {
        "status": 200,
        "delayMs": 0,

        "headers": {
          "x-mock": "true"
        },

        "body": {
          "success": true
        },

        "interceptors": ["encrypt"]
      }
    }
  ]
}
```

---

# Route Definition

```ts
interface MockRoute {
  id: string;

  method: HttpMethod;

  path: string;

  request?: {
    interceptors?: string[];
  };

  response?: {
    status?: number; // default 200

    delayMs?: number; // default 0

    headers?: Record<string, string>;

    body?: unknown; // omit for 204

    interceptors?: string[];
  };

  handler?: string; // "login" — no extension
}
```

Rules:

- A route may define `response`
- A route may define `handler`
- A route must define exactly one of them
- `path` must start with `/`
- `METHOD + PATH` must be unique across all routes

---

# Route IDs

`id` is **server-owned**.

- Generated by the server, never by the UI
- Format: `r_` + 6 hex characters
- Assigned on load to any route missing one
- When any id is assigned, `mockr.json` is rewritten immediately

Consequence:

A user may hand-write `mockr.json` with no ids. On next load, Mockr fills
them in and saves. Ids are then stable across edits, and `PUT`/`DELETE`
by id are safe.

---

# Route Matching

Matching key:

```text
METHOD + PATH
```

Examples:

```text
GET:/users
POST:/login
GET:/users/:id
```

## Supported

Methods:

```text
GET
POST
PUT
PATCH
DELETE
HEAD
```

Path parameters:

```text
/users/:id
/orders/:orderId/items/:itemId
```

Parameters are exposed as:

```js
ctx.request.params.id;
```

Path parameters are in MVP scope. `/users/:id` is the single most common
mock shape; requiring one route per id makes the tool unusable.

## Normalization

```text
Query string is stripped before matching
Trailing slashes are normalized     /users/  ==  /users
Paths are case-sensitive
Methods are case-insensitive
```

`HEAD` falls back to the matching `GET` route, with the body discarded.

## Not supported

- Regex routes
- Wildcard routes
- Header matching
- Query matching
- Body matching

## Precedence

Static segments beat parameters.

```text
/users/me      wins over      /users/:id
```

---

# Static Response Route

```json
{
  "method": "GET",
  "path": "/users",

  "response": {
    "status": 200,

    "body": {
      "users": []
    }
  }
}
```

Empty response:

```json
{
  "method": "DELETE",
  "path": "/users/:id",

  "response": {
    "status": 204
  }
}
```

---

# Dynamic Handler Route

```json
{
  "method": "POST",
  "path": "/login",

  "handler": "login"
}
```

Resolves to:

```text
handlers/login.js
```

Handlers and interceptors are both referenced **by name, without
extension**, and both resolve to `<dir>/<name>.js`.

---

# Handler Contract

File:

```text
handlers/login.js
```

Implementation:

```js
module.exports = async function (ctx) {
  return {
    status: 200,

    headers: {
      'content-type': 'application/json',
    },

    body: {
      token: 'abc123',
    },
  };
};
```

Return shape:

```ts
interface HandlerResult {
  status?: number; // default 200
  headers?: Record<string, string>;
  body?: unknown; // omit for 204
}
```

A handler that returns nothing produces `204`.

Module-level state is **not** preserved across hot reloads. Handlers
should be treated as stateless.

---

# Request/Response Context

```ts
interface Ctx {
  request: {
    method: string;
    path: string;
    params: Record<string, string>;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: unknown;
  };

  response?: {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
  };

  route: {
    id: string;
    path: string;
  };
}
```

## Availability by phase

```text
Phase                      ctx.request     ctx.response
─────────────────────────────────────────────────────────
Request interceptors       populated       undefined
Handler                    populated       undefined
Response interceptors      populated       populated
```

`ctx.response` does not exist during the request phase — it has not been
produced yet. Reading it there is a bug, not a feature.

---

# Interceptor System

## Purpose

Interceptors allow users to customize behavior without modifying Mockr.

Examples:

- Request decryption
- Response encryption
- Payload validation
- Authentication simulation
- Request transformation
- Response transformation

---

# Interceptor Location

```text
interceptors/
```

Referenced by name:

```text
"decrypt"    ->    interceptors/decrypt.js
"encrypt"    ->    interceptors/encrypt.js
"validate"   ->    interceptors/validate.js
```

Name resolution is path-guarded. A resolved path that escapes the
`interceptors/` directory is rejected at validation time.

```text
"../../evil"    ->    rejected
```

---

# Interceptor Contract

Interceptors **mutate** `ctx`. Return values are ignored.

```js
module.exports = async function (ctx) {
  ctx.request.body.userId = '123';
};
```

Reason:

`return ctx` in every example means a forgotten `return` silently
produces `undefined` and destroys the context. Mutation-only removes the
footgun entirely.

---

# Validation Example

```js
module.exports = async function (ctx) {
  if (!ctx.request.body.email) {
    throw new Error('email required');
  }
};
```

---

# Decryption Example

```js
module.exports = async function (ctx) {
  ctx.request.body = decrypt(ctx.request.body);
};
```

---

# Encryption Example

```js
module.exports = async function (ctx) {
  ctx.response.body = encrypt(ctx.response.body);
};
```

---

# Short-Circuiting

A request interceptor may end the request early by setting
`ctx.response`.

```js
module.exports = async function (ctx) {
  if (!ctx.request.headers.authorization) {
    ctx.response = {
      status: 401,
      body: { error: 'unauthorized' },
    };
  }
};
```

Behavior:

```text
ctx.response set during request phase
       │
       ▼
Remaining request interceptors are skipped
Handler / static response is skipped
       │
       ▼
Response interceptors run normally
```

This is what makes "authentication simulation" possible. Without it, the
only exit from an interceptor is `throw`, which cannot express a 401.

## Structured errors

Interceptors and handlers may throw an error carrying an explicit
status and body.

```js
const err = new Error('bad signature');
err.status = 403;
err.body = { error: 'bad signature' };
throw err;
```

If `status` is present, Mockr uses it verbatim.

---

# Runtime Pipeline

```text
Incoming Request
       │
       ▼
CORS / OPTIONS preflight
       │
       ▼
Route Lookup ──────────► 404
       │
       ▼
Request Interceptors ──► short-circuit ──┐
       │                                 │
       ▼                                 │
Handler OR Static Response               │
       │                                 │
       ▼◄────────────────────────────────┘
Response Interceptors
       │
       ▼
Delay
       │
       ▼
Return Response
```

Notes:

- Delay applies only to matched routes. A `404` returns immediately.
- Preflight never reaches interceptors.

---

# Registry

Purpose:

Maintain active routes in memory.

Interface:

```ts
interface RouteRegistry {
  load(): Promise<void>;

  reload(): Promise<void>;

  get(method: string, path: string): RouteMatch | undefined;

  status(): RegistryStatus;
}

interface RouteMatch {
  route: MockRoute;
  params: Record<string, string>;
}

interface RegistryStatus {
  ok: boolean;
  routeCount: number;
  loadedAt: string;
  errors: MockrError[];
}
```

Implementation:

```text
MemoryRouteRegistry
```

## Last-good semantics

If a reload fails — invalid JSON, schema violation, handler syntax error —
the registry **keeps serving the previous valid state** and records the
error in `status()`.

Mockr never crashes, and never silently serves an empty route table,
because the user was mid-keystroke in `mockr.json`.

---

# Storage Layer

Purpose:

Read and write:

```text
mockr.json
```

Interface:

```ts
interface RouteStore {
  getRoutes(): Promise<MockRoute[]>;

  saveRoutes(routes: MockRoute[]): Promise<void>;
}
```

Implementation:

```text
JsonFileStore
```

## Atomic writes

```text
write   mockr.json.tmp
fsync
rename  mockr.json.tmp -> mockr.json
```

A crash mid-write must never truncate the user's configuration.

---

# Validation

`mockr.json` is validated against a JSON Schema on every load and before
every write, using the `ajv` instance Fastify already ships.

Checks:

```text
method is one of the supported verbs
path starts with "/"
exactly one of response / handler is present
METHOD + PATH is unique
delayMs >= 0
status is 100-599
referenced handler file exists
referenced interceptor files exist
resolved paths stay inside handlers/ and interceptors/
```

Failures are collected, not thrown on the first one, so the UI can show
every problem at once.

---

# Interceptor Loader

Purpose:

Load interceptors dynamically.

Interface:

```ts
interface InterceptorLoader {
  load(name: string): Promise<Interceptor>;

  invalidate(name: string): void;
}
```

Resolves:

```text
interceptors/<name>.js
```

---

# Handler Loader

Purpose:

Load custom route handlers dynamically.

Interface:

```ts
interface HandlerLoader {
  load(name: string): Promise<RouteHandler>;

  invalidate(name: string): void;
}
```

Resolves:

```text
handlers/<name>.js
```

## Eager loading

Handlers and interceptors are loaded **eagerly** during reload, not
lazily on first request.

Reason:

A syntax error in `payment.js` should appear in the UI the moment you
save it — not as a mystery `500` an hour later.

Load failures are recorded in `RegistryStatus.errors`. The route stays
registered and returns `500` with the load error until the file is fixed.

---

# Hot Reload

Watch:

```text
mockr.json
handlers/**/*.js
interceptors/**/*.js
```

On change:

```text
Invalidate only the changed module
Reload routes
Revalidate
Swap registry atomically
```

Server restart must not be required.

## Correctness requirements

**Partial writes**

```js
chokidar.watch(paths, {
  awaitWriteFinish: {
    stabilityThreshold: 150,
    pollInterval: 30,
  },
});
```

Plus a 100ms debounce, so a multi-file save triggers one reload.

**Write feedback loop**

The management API writes `mockr.json`, which trips the watcher, which
reloads. The store records the hash of its own last write; a watcher
event matching that hash is ignored.

**In-flight requests**

A request that has already begun executing keeps the handler module
reference it started with. The swap affects the next request, never a
running one.

**Invalid state**

Covered by last-good semantics in the registry.

---

# HTTP Runtime

Use a single catch-all route.

Example:

```js
app.all('*', async (req, res) => {});
```

Flow:

```text
Request
   │
   ▼
Registry Lookup
   │
   ▼
Pipeline Execution
   │
   ▼
Response
```

Avoid dynamic route registration.

Reason:

Registry swaps stay trivial, and Fastify's router is never mutated at
runtime.

---

# Request Logging

Every request to the mock server is logged to stdout.

```text
POST  /login          200   12ms   handler:login
GET   /users          200    0ms   static
GET   /missing        404    0ms   —
POST  /pay            400    3ms   interceptor:validate
```

This is live logging, not request recording. Nothing is persisted.

`--quiet` disables it.

---

# Management API

Served on the admin port. Used by the UI.

## Routes

```http
GET    /api/routes
GET    /api/routes/:id
POST   /api/routes
PUT    /api/routes/:id
DELETE /api/routes/:id
```

These endpoints modify:

```text
mockr.json
```

Writes are validated before being persisted. A rejected write returns
`422` with the full list of validation errors and does not touch the file.

## Discovery

```http
GET    /api/handlers
GET    /api/interceptors
```

Returns the available files by name, so the UI can present a dropdown
instead of a free-text field.

```json
{
  "handlers": ["login", "payment"]
}
```

## Status

```http
GET    /api/status
```

```json
{
  "ok": true,
  "routeCount": 12,
  "loadedAt": "2026-08-20T10:00:00.000Z",
  "mockPort": 4000,
  "errors": []
}
```

The UI polls this every 2 seconds to detect out-of-band file edits and to
surface load errors. WebSockets remain a non-goal.

## Module sources

Handlers and interceptors are editable through the API, and therefore
from the UI.

```http
GET    /api/handlers/:name
PUT    /api/handlers/:name        { "source": "..." }
DELETE /api/handlers/:name

GET    /api/interceptors/:name
PUT    /api/interceptors/:name
DELETE /api/interceptors/:name
```

Rules:

```text
Names are plain filenames, never paths
Resolved paths must stay inside their directory
Source is parsed before it is written
A write that does not compile returns 422 and changes nothing
New files follow the project's module system (.cjs when ESM)
Existing files keep the extension they already have
```

Reason:

The original scope excluded this on the grounds that users have their own
editors. In practice it breaks the core flow — creating a route in the UI
and then being sent elsewhere to write the file that route points at.

Dependencies remain the user's own. A handler may require anything
installed in their project; Mockr installs nothing.

---

# Error Handling

## Route Not Found

Status:

```http
404
```

```json
{
  "error": "route not found"
}
```

---

## Request Interceptor Error

Status:

```http
400
```

```json
{
  "error": "email required",
  "interceptor": "validate"
}
```

The thrown message is surfaced, not replaced. A hardcoded
`"validation failed"` makes debugging impossible.

Overridden by `err.status` / `err.body` when present.

---

## Response Interceptor Error

Status:

```http
500
```

```json
{
  "error": "encryption failed",
  "interceptor": "encrypt"
}
```

The request was valid. The failure is server-side, so this is `500`, not
`400`.

---

## Handler Error

Status:

```http
500
```

```json
{
  "error": "handler execution failed",
  "handler": "login",
  "message": "Cannot read property 'id' of undefined"
}
```

---

## Handler / Interceptor Load Error

Status:

```http
500
```

```json
{
  "error": "handler failed to load",
  "handler": "login",
  "message": "Unexpected token ')'"
}
```

---

## Internal Error

Status:

```http
500
```

```json
{
  "error": "internal server error"
}
```

All errors are also written to the request log with a full stack trace.

---

# Web UI

Served on the admin port.

## Route List

Display:

```text
Method
Path
Status
Type
```

Type:

```text
Static
Handler
```

A duplicate `METHOD + PATH` is flagged inline before save.

A banner shows `GET /api/status` errors when the config or a user module
fails to load.

---

# Route Editor

Editable fields:

```text
Method

Path

Status

Delay

Response Headers

Request Interceptors      (dropdown, from /api/interceptors)

Response Interceptors     (dropdown, from /api/interceptors)

Response Body

Handler                   (dropdown, from /api/handlers)
```

`Response` fields and `Handler` are mutually exclusive in the UI, matching
the route rule.

---

# JSON Editor

Requirements:

- Pretty formatting
- Validation before save
- Error highlighting

---

# Delay Support

Configuration:

```json
{
  "delayMs": 1000
}
```

Behavior:

```text
Wait 1000ms
Return response
```

Applies after response interceptors, only on matched routes.

---

# Testing

```text
Unit         registry, store, matcher, validation, loaders
Integration  full pipeline over a temp project directory
Reload       write file -> assert new behavior without restart
```

Reload tests are mandatory. Hot reload is the feature most likely to
break silently.

---

# Recommended Stack

Backend:

```text
Node.js
TypeScript (compiled to CommonJS)
Fastify
@fastify/cors
Chokidar
Ajv
```

Frontend:

```text
React
Vite
Monaco Editor
```

Storage:

```text
JSON File
```

Only.

No database.

---

# Non-Goals For MVP

Do not implement:

- OpenAPI import
- GraphQL
- WebSockets
- Authentication system
- Multi-user support
- Teams
- Database storage
- Regex routes
- Wildcard routes
- Request recording
- Response scenarios
- AI generation
- Cloud sync
- Plugin marketplace
- Sandboxed user code
- ESM user code
- Managing the user's dependencies

---

# Success Criteria

A user should be able to:

1. Run `npx mockr`
2. Open the UI
3. Create a route
4. Paste JSON
5. Save
6. Call the endpoint immediately

Total setup time should be under 60 seconds.

Additionally, advanced users should be able to:

1. Create a JavaScript interceptor
2. Attach it to a route
3. Modify requests or responses
4. Hot reload changes without restarting Mockr

And in all cases:

1. A browser app on another port can call the mocks without CORS errors
2. A malformed edit never crashes the server or empties the route table

This is the complete MVP scope.

---

# Appendix: Resolved Design Decisions

| #   | Question                              | Decision                                                                 |
| --- | ------------------------------------- | ------------------------------------------------------------------------ |
| 1   | CJS or ESM for user code              | CommonJS. ESM cannot invalidate its module cache.                        |
| 2   | Catch-all vs management API collision | Two ports. Mock surface stays completely clean.                          |
| 3   | CORS                                  | Permissive by default, auto preflight. Required by the primary use case. |
| 4   | Route `id` ownership                  | Server-generated, backfilled on load, file rewritten.                    |
| 5   | Path parameters                       | In scope. Regex and wildcards remain out.                                |
| 6   | Response headers                      | Added to static responses and handler results.                           |
| 7   | Interceptor short-circuit             | Set `ctx.response` during the request phase.                             |
| 8   | Interceptor return value              | Ignored. Mutation only.                                                  |
| 9   | `ctx.response` in request phase       | Undefined. Documented per phase.                                         |
| 10  | Interceptor error status              | `400` for request, `500` for response, `err.status` wins.                |
| 11  | `status` / `body` optionality         | `status` defaults to 200, `body` optional for 204.                       |
| 12  | Reload races                          | `awaitWriteFinish`, debounce, write-hash suppression, atomic swap.       |
| 13  | Loader timing                         | Eager on reload, errors surfaced via `/api/status`.                      |
| 14  | Config validation                     | Ajv schema, all errors collected.                                        |
| 15  | Interceptor path traversal            | Resolved paths must stay inside their directory.                         |
| 16  | Trust model                           | Stated explicitly. Binds to `127.0.0.1`.                                 |
| 17  | How to run it                         | `npx mockr`, `mockr init`, documented flags.                             |
| 18  | Request logging                       | Live stdout log. Not recording.                                          |
| 19  | UI's missing endpoints                | Added discovery, status, and `GET /api/routes/:id`.                      |
| 20  | Testing                               | Unit, integration, and mandatory reload tests.                           |

## Revisions after implementation

| Question                         | Decision                                                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects with `"type": "module"` | `.cjs` and `.js` both resolve; scaffolding picks by project type. A CommonJS `.js` file cannot load in an ESM project, so the error names the rename that fixes it.                                 |
| Editing JS from the UI           | Now in scope. Sources are readable and writable over the admin API, parsed before saving.                                                                                                           |
| Package name                     | `mockr` is taken by a package last published in 2014, so this ships as `mockrjs` with a `mockr` binary.                                                                                             |
| Watcher startup                  | `start()` waits for chokidar's initial scan, otherwise edits made moments after boot are silently dropped.                                                                                          |
| Server settings                  | Configurable in a `server` block in `mockr.json`, not only by flag. Flags beat the file, the file beats the defaults, resolved per key.                                                             |
| Writing `mockr.json`             | `saveRoutes` merges into the existing document instead of replacing it, so the user's `server` block survives a route save.                                                                         |
| Changing ports at runtime        | Ports and host bind once. A reload that finds them changed warns to restart instead of appearing to apply.                                                                                          |
| Module settings                  | Top-level `interceptors` and `handlers` blocks, keyed by module name, passed to each module as a second argument. `${VAR}` expands from the environment so secrets are named rather than committed. |
| Built-in modules                 | `@`-prefixed names are provided by Mockr: `@jwt`, `@apiKey`, `@jwt.sign`. Configured through the same blocks, validated when the config loads rather than on first request.                         |
| JWT implementation               | HMAC only, on `node:crypto`, rather than adding a JWT dependency. `alg: none` and unlisted algorithms are refused.                                                                                  |
