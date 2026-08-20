# Contributing to Mockr

Thanks for being here. This document covers how to get set up, what the code
expects of a change, and the handful of places where a well-meaning patch is
most likely to break something quietly.

## Getting set up

```bash
git clone git@github.com:ZethicTech/api-mockr.git
cd api-mockr
npm install
npm run dev
```

`npm run dev` starts the server against a scratch project in `demo/`, which
scaffolds itself on first run and is gitignored.

```
  mock server   http://localhost:4000
  admin + UI    http://localhost:4100
```

Editing anything under `ui/` rebuilds in about 200ms — refresh the page. The
server needs a restart, since it is compiled TypeScript.

|                     |                                         |
| ------------------- | --------------------------------------- |
| `npm run dev`       | server plus UI rebuild, against `demo/` |
| `npm test`          | build, then unit and end-to-end tests   |
| `npm run typecheck` | both TypeScript projects                |
| `npm run format`    | Prettier over the repository            |
| `npm run build`     | server to `dist/`, UI to `dist/ui/`     |

Before opening a pull request, run all three:

```bash
npm run format && npm run typecheck && npm test
```

There is no CI yet, so this is the only thing standing between a change and
`main` — please actually run it. Mockr supports Node 20 and above; if your
change touches file watching, it is worth a thought for Windows and macOS,
which handle it differently.

## How the code is laid out

```
src/
  cli/          argument parsing and the mockr command
  config.ts     resolves flags over mockr.json over defaults
  app.ts        wires everything together and starts both servers
  http/         the mock server — one catch-all route
  api/          the admin API and the UI's static assets
  runtime/      the request pipeline
  registry/     the in-memory route table
  matcher/      method and path matching
  storage/      reading and writing mockr.json and module files
  loaders/      loading user handlers and interceptors
  builtin/      @jwt, @apiKey, @jwt.sign
  validation/   schema and cross-field rules
  watcher/      hot reload
ui/src/         the Preact admin UI
test/           unit and end-to-end tests
docs/spec.md    the architecture, and why each decision was made
```

`docs/spec.md` is worth reading before a substantial change. It records the
reasoning behind decisions that look arbitrary otherwise, including several
that were revised after the first implementation.

## Four places to tread carefully

These are where a reasonable-looking change breaks something that no obvious
test covers.

**Hot reload.** A failed reload must leave the previous valid state serving.
Mockr should never crash or empty its route table because someone is
mid-keystroke in `mockr.json`. If you touch the watcher or the registry, keep
the reload tests passing — they exist because this is easy to get wrong and
hard to notice.

**Module loading is CommonJS.** Not a style preference: `delete require.cache`
is the only cache invalidation Node offers, and ESM has none. Switching to
`import()` would silently cost hot reload, which is the feature people load
modules for. `.cjs` and `.js` both resolve, because a `.js` file in a project
with `"type": "module"` is ESM and cannot use `module.exports`.

**Writing `mockr.json`.** It is the user's file. `saveRoutes` merges into the
existing document rather than replacing it, so their `server` and
`interceptors` blocks survive. Writes are atomic, and the store records the
hash of what it wrote so the watcher can ignore its own change instead of
looping.

**Error statuses follow the phase.** A request interceptor that throws is a
400; a response interceptor that throws is a 500, because by then the request
was accepted and the failure is the server's. A `status` set on the thrown
error wins over both, and is treated as deliberate — no stack trace, because
it is an intended outcome rather than a fault.

## Tests

Tests run against the build, in throwaway project directories, so loaders
exercise real files through `require` rather than a stub.

```bash
npm test                              # everything
node --test test/pipeline.test.js     # one file, after npm run build:server
```

New behaviour needs a test. The bar is not coverage percentage — it is whether
a future change that breaks this would be caught. For anything touching
reload, add a case to `test/integration.test.js`, which drives real servers
over HTTP on ephemeral ports.

If you hit a flaky test, say so in the issue rather than adding a retry. The
one known source of flakiness is timing around file watching under load.

## Style

Prettier settles formatting; run `npm run format` and move on.

Beyond that, the code aims for a particular kind of comment: not what a line
does, but why it is that way. A comment explaining that a regex matches a
string is noise. A comment explaining that the algorithm allow-list exists
because trusting the token's own header is the classic JWT hole is the reason
the next person does not "simplify" it.

TypeScript is strict. Prefer making an invalid state unrepresentable —
`ctx.response` is optional because it genuinely does not exist during the
request phase, and the type says so rather than lying.

## Commits and pull requests

Commit messages follow `type(scope): summary` — `feat`, `fix`, `docs`,
`test`, `chore`, `refactor`. The summary line says what changed; the body
says why, and what would otherwise have gone wrong. Assume the reader is you,
in a year, wondering what this was for.

Keep a pull request to one concern. A formatting sweep mixed into a bug fix
makes the fix impossible to review, and impossible to revert alone later.

## Scope

Mockr stays small on purpose. The README lists what is deliberately not
implemented — regex and wildcard routes, request recording, response
scenarios, OpenAPI import, GraphQL, WebSockets, auth, multi-user, a database,
and a passthrough proxy for unmatched requests.

Those are decisions rather than gaps, but they are not sacred. If you think
one is wrong, open an issue arguing the reasoning rather than opening a pull
request that assumes it.

Things that are welcome without discussion: bug fixes, tests for existing
behaviour, documentation, error messages that explain themselves better, and
platform fixes — particularly Windows, which gets the least real-world use.

Larger changes are worth an issue first, so nobody spends a weekend on
something that turns out to be a non-goal.

## Reporting a security issue

Please do not open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).
