# Security Policy

## Supported versions

Mockr is pre-1.0. Fixes land on the latest released minor; there are no
backports yet.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

## Reporting a vulnerability

Please report privately rather than opening a public issue:

- [Open a draft advisory](https://github.com/ZethicTech/api-mockr/security/advisories/new) — preferred
- Or email **security@zethic.com**

Please include what you found, how to reproduce it, and what an attacker
gains. A proof of concept helps, even a rough one.

You can expect an acknowledgement within a few working days and an assessment
after that. If a fix is warranted, we will credit you in the release notes
unless you would rather stay anonymous.

## What Mockr is, and is not

Mockr is a local development tool, and its threat model reflects that. The
following are **known and intentional**, documented here so nobody reports
them as findings:

**Handlers and interceptors are unsandboxed.** They are ordinary Node modules,
loaded with `require` and run in process with full privileges — filesystem,
network, child processes. That is what makes them useful. Anyone who can write
to `handlers/` or `interceptors/` can run arbitrary code as the user running
Mockr, which is the same power they already had by writing to the project.

**The management API is unauthenticated.** Anything that can reach the admin
port can create routes and write module files, which means executing code.

**Because of both, everything binds to `127.0.0.1` by default.** Passing
`--host 0.0.0.0` exposes local code execution to your network. That is
documented, not defended against — do it only on a network you trust.

**Mocks are not a security boundary.** The `@jwt` and `@apiKey` built-ins
exist so a route can require a plausible token during development. They are
not an authorization system, and Mockr is not meant to run in production or
hold real secrets.

## What we do want to hear about

Within that model, these are real issues:

- Escaping the `handlers/` or `interceptors/` directory through a crafted
  module name, so a write or read lands outside the project
- Anything that lets a **mock request** — traffic to the mock port, not the
  admin port — read or write files, or run code it should not
- JWT verification accepting a token it should reject: an unsigned token, a
  wrong algorithm, a bad signature, or an expired one
- Path traversal or injection through route paths, headers, or config values
- A dependency vulnerability that Mockr actually exposes

If you are unsure whether something falls inside the model, report it anyway
and we will work it out.
