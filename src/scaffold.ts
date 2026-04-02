import fs from 'node:fs';
import path from 'node:path';
import { ProjectPaths, isEsmProject, scaffoldExtension } from './util/paths';

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
  /** True when handlers were written as .cjs because the project is ESM. */
  esm: boolean;
}

/** Idempotent: existing files are never overwritten. */
export function scaffold(paths: ProjectPaths): ScaffoldResult {
  const created: string[] = [];
  const ext = scaffoldExtension(paths.dir);

  fs.mkdirSync(paths.dir, { recursive: true });

  for (const dir of [paths.handlersDir, paths.interceptorsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(path.relative(paths.dir, dir) + '/');
    }
  }

  // In a project with "type": "module" a .js file is ESM, so a CommonJS
  // handler in one cannot load. Scaffold .cjs there instead.
  const files: Array<[string, string]> = [
    [paths.configFile, EXAMPLE_CONFIG],
    [path.join(paths.handlersDir, `login${ext}`), EXAMPLE_HANDLER],
    [path.join(paths.interceptorsDir, `requireAuth${ext}`), EXAMPLE_INTERCEPTOR],
  ];

  for (const [file, content] of files) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, content, 'utf8');
      created.push(path.relative(paths.dir, file));
    }
  }

  return { created, esm: isEsmProject(paths.dir) };
}
