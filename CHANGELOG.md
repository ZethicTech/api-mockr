# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While Mockr is pre-1.0, the config format may change between minor versions.
Any change that requires editing `mockr.json` will be called out here.

## [Unreleased]

## [0.1.0] - 2026-08-18

First release.

### Added

- **Mock server** with a single catch-all route. Static responses configured
  as JSON, or JavaScript handlers when the response depends on the request.
- **Path parameters** (`/users/:id`), with static segments taking precedence
  over parameters. Query strings and trailing slashes are normalised before
  matching, and `HEAD` falls back to the matching `GET` route.
- **Interceptors** that run before and after the response, attached per route.
  A request interceptor can end the request early by setting `ctx.response`,
  which is what makes simulated auth expressible.
- **Hot reload** for `mockr.json`, handlers and interceptors. A failed reload
  keeps the last valid configuration serving and reports why.
- **Web UI** on its own port for creating routes and writing handler and
  interceptor code, including a JSON editor and a JavaScript editor.
- **Management API** for routes, module sources, discovery and status.
- **Built-in auth**: `@jwt` verifies a bearer token and attaches its claims to
  `ctx.request.user`, `@apiKey` checks a header or query parameter, and
  `@jwt.sign` issues tokens so a protected route can actually be exercised.
  HMAC only, implemented on `node:crypto` rather than a JWT dependency.
- **Module settings** in `mockr.json`, keyed by module name and passed to each
  handler and interceptor as a second argument. Values support `${VAR}`
  expansion so secrets can be named rather than committed.
- **Server settings** in `mockr.json`, resolved per key as flag over file over
  default.
- **Delays** per route, permissive CORS with automatic preflight, and a live
  request log.
- **CommonJS module loading** that resolves `.cjs` and `.js`, choosing the
  right one for the project's module system. ESM projects get `.cjs`
  scaffolded, and a CommonJS `.js` file in one fails with a message naming the
  rename that fixes it.
- **Validation** of the whole config against a schema plus cross-field rules,
  reporting every problem at once rather than the first.

### Security

- Both servers bind to `127.0.0.1` by default. Handler and interceptor module
  names are confined to their directories.
- JWT verification rejects unsigned tokens (`alg: none`) and any algorithm
  outside the configured allow-list, and compares signatures in constant time.

[Unreleased]: https://github.com/ZethicTech/api-mockr/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ZethicTech/api-mockr/releases/tag/v0.1.0
