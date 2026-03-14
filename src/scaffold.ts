import fs from 'node:fs';
import path from 'node:path';
import { ProjectPaths } from './util/paths';

const EXAMPLE_CONFIG = `{
  "routes": [
    {
      "id": "r_000001",
      "method": "GET",
      "path": "/users",
      "response": {
        "status": 200,
        "body": {
          "users": [
            { "id": 1, "name": "Ada" },
            { "id": 2, "name": "Grace" }
          ]
        }
      }
    },
    {
      "id": "r_000002",
      "method": "GET",
      "path": "/users/:id",
      "response": {
        "status": 200,
        "body": { "id": 1, "name": "Ada" }
      }
    },
    {
      "id": "r_000003",
      "method": "POST",
      "path": "/login",
      "handler": "login"
    }
  ]
}
`;

const EXAMPLE_HANDLER = `// Handlers are CommonJS. Return { status, headers, body } — all optional.
// Edit and save; Mockr hot reloads without a restart.

module.exports = async function (ctx) {
  const { email } = ctx.request.body || {};

  if (!email) {
    const err = new Error('email is required');
    err.status = 400;
    err.body = { error: 'email is required' };
    throw err;
  }

  return {
    status: 200,
    body: {
      token: 'mock-token-' + Date.now(),
      email,
    },
  };
};
`;

const EXAMPLE_INTERCEPTOR = `// Interceptors mutate ctx. Return values are ignored.
//
//   request phase:  ctx.response is undefined
//                   set ctx.response to short-circuit (e.g. a 401)
//   response phase: ctx.response is populated

module.exports = async function (ctx) {
  if (!ctx.request.headers.authorization) {
    ctx.response = {
      status: 401,
      headers: {},
      body: { error: 'unauthorized' },
    };
  }
};
`;

export interface ScaffoldResult {
  created: string[];
}

/** Idempotent: existing files are never overwritten. */
export function scaffold(paths: ProjectPaths): ScaffoldResult {
  const created: string[] = [];

  fs.mkdirSync(paths.dir, { recursive: true });

  for (const dir of [paths.handlersDir, paths.interceptorsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(path.relative(paths.dir, dir) + '/');
    }
  }

  const files: Array<[string, string]> = [
    [paths.configFile, EXAMPLE_CONFIG],
    [path.join(paths.handlersDir, 'login.js'), EXAMPLE_HANDLER],
    [path.join(paths.interceptorsDir, 'requireAuth.js'), EXAMPLE_INTERCEPTOR],
  ];

  for (const [file, content] of files) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, content, 'utf8');
      created.push(path.relative(paths.dir, file));
    }
  }

  return { created };
}
