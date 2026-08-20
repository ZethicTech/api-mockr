const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../dist/app');
const { tempProject, until } = require('./helpers');

const CONFIG = {
  routes: [
    { id: 'r_stat01', method: 'GET', path: '/users', response: { status: 200, body: { users: [] } } },
    { id: 'r_para01', method: 'GET', path: '/users/:id', handler: 'byId' },
  ],
};

const HANDLER = `module.exports = (ctx) => ({ status: 200, body: { id: ctx.request.params.id } });`;

/** Boot a real server pair on ephemeral ports against a throwaway project. */
async function withServer(run, files = {}) {
  const project = tempProject({ 'mockr.json': CONFIG, 'handlers/byId.js': HANDLER, ...files });
  const server = await start({
    dir: project.dir,
    port: 0,
    adminPort: 0,
    host: '127.0.0.1',
    cors: true,
    quiet: true,
    silent: true,
    uiDir: null,
  });

  const mock = (p, init) => fetch(`http://127.0.0.1:${server.mockPort}${p}`, init);
  const admin = (p, init) => fetch(`http://127.0.0.1:${server.adminPort}${p}`, init);
  const json = (p, init) => admin(p, init).then((r) => r.json());

  try {
    await run({ project, server, mock, admin, json });
  } finally {
    await server.close();
    project.cleanup();
  }
}

test('serves static routes and handler routes', async () => {
  await withServer(async ({ mock }) => {
    const users = await mock('/users');
    assert.equal(users.status, 200);
    assert.deepEqual(await users.json(), { users: [] });

    const one = await mock('/users/42');
    assert.deepEqual(await one.json(), { id: '42' });
  });
});

test('unmatched routes are 404', async () => {
  await withServer(async ({ mock }) => {
    const res = await mock('/nothing-here');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'route not found' });
  });
});

test('answers CORS preflight without reaching the routes', async () => {
  await withServer(async ({ mock }) => {
    const res = await mock('/users', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
    });
    assert.ok(res.status === 204 || res.status === 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);
  });
});

test('HEAD returns the GET status with no body', async () => {
  await withServer(async ({ mock }) => {
    const res = await mock('/users', { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
  });
});

test('the admin API creates a route that serves immediately', async () => {
  await withServer(async ({ mock, admin }) => {
    const created = await admin('/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/health', response: { status: 200, body: { ok: true } } }),
    });
    assert.equal(created.status, 201);
    assert.match((await created.json()).id, /^r_[0-9a-f]{6}$/);

    const res = await mock('/health');
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('the admin API updates and deletes routes', async () => {
  await withServer(async ({ mock, admin }) => {
    const updated = await admin('/api/routes/r_stat01', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/users',
        response: { status: 200, body: { users: ['ada'] } },
      }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(await (await mock('/users')).json(), { users: ['ada'] });

    const deleted = await admin('/api/routes/r_stat01', { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    assert.equal((await mock('/users')).status, 404);
  });
});

test('a client cannot reassign a route id', async () => {
  await withServer(async ({ admin }) => {
    const res = await admin('/api/routes/r_stat01', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'hijacked', method: 'GET', path: '/users', response: { status: 200 } }),
    });
    assert.equal((await res.json()).id, 'r_stat01');
  });
});

test('an invalid write is rejected with 422 and never touches the file', async () => {
  await withServer(async ({ admin, project }) => {
    const before = project.read('mockr.json');
    const res = await admin('/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/users', response: { status: 200 } }),
    });
    assert.equal(res.status, 422);
    assert.match(JSON.stringify((await res.json()).issues), /duplicate route/);
    assert.equal(project.read('mockr.json'), before);
  });
});

test('discovery lists handlers and interceptors', async () => {
  await withServer(
    async ({ json }) => {
      assert.deepEqual((await json('/api/handlers')).handlers, ['byId']);
      assert.deepEqual((await json('/api/interceptors')).interceptors, ['guard']);
    },
    { 'interceptors/guard.js': 'module.exports = () => {};' },
  );
});

test('editing a handler on disk hot reloads without a restart', async () => {
  await withServer(async ({ mock, project }) => {
    assert.deepEqual(await (await mock('/users/1')).json(), { id: '1' });

    project.write('handlers/byId.js', `module.exports = () => ({ status: 201, body: { reloaded: true } });`);

    const res = await until(async () => {
      const r = await mock('/users/1');
      return r.status === 201 ? r : null;
    });
    assert.deepEqual(await res.json(), { reloaded: true });
  });
});

test('editing mockr.json on disk hot reloads without a restart', async () => {
  await withServer(async ({ mock, project }) => {
    project.write('mockr.json', {
      routes: [
        { id: 'r_new001', method: 'GET', path: '/added', response: { status: 200, body: { added: true } } },
      ],
    });

    const res = await until(async () => {
      const r = await mock('/added');
      return r.status === 200 ? r : null;
    });
    assert.deepEqual(await res.json(), { added: true });
  });
});

test('a broken config keeps the last good routes serving and reports the error', async () => {
  await withServer(async ({ mock, json, project }) => {
    project.write('mockr.json', '{ "routes": [ BROKEN');

    const status = await until(async () => {
      const s = await json('/api/status');
      return s.ok === false ? s : null;
    });
    assert.match(status.errors[0].message, /not valid JSON/);

    // Last-good state is still serving.
    assert.equal((await mock('/users')).status, 200);

    project.write('mockr.json', CONFIG);
    const recovered = await until(async () => {
      const s = await json('/api/status');
      return s.ok === true ? s : null;
    });
    assert.equal(recovered.routeCount, 2);
  });
});

test('a handler with a syntax error is reported without taking the server down', async () => {
  await withServer(async ({ mock, json, project }) => {
    project.write('handlers/byId.js', 'module.exports = (');

    const status = await until(async () => {
      const s = await json('/api/status');
      return s.errors.length > 0 ? s : null;
    });
    assert.equal(status.errors[0].scope, 'handler');

    // The broken route reports the load failure; the rest keep working.
    const broken = await mock('/users/1');
    assert.equal(broken.status, 500);
    assert.equal((await broken.json()).error, 'handler failed to load');
    assert.equal((await mock('/users')).status, 200);
  });
});

test('a handler written through the API is live on the next request', async () => {
  await withServer(async ({ mock, admin, json }) => {
    const created = await admin('/api/handlers/greet', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'module.exports = () => ({ status: 200, body: { hi: true } });' }),
    });
    assert.equal(created.status, 200);
    assert.deepEqual((await json('/api/handlers')).handlers.includes('greet'), true);

    await admin('/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/greet', handler: 'greet' }),
    });
    assert.deepEqual(await (await mock('/greet')).json(), { hi: true });

    // Editing the source takes effect without a restart.
    await admin('/api/handlers/greet', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'module.exports = () => ({ status: 201, body: { edited: true } });' }),
    });
    const edited = await mock('/greet');
    assert.equal(edited.status, 201);
    assert.deepEqual(await edited.json(), { edited: true });
  });
});

test('code that does not parse is rejected without disturbing the running route', async () => {
  await withServer(async ({ mock, admin }) => {
    const res = await admin('/api/handlers/byId', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'module.exports = (' }),
    });
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /syntax error/);

    // The previous version is untouched and still serving.
    assert.deepEqual(await (await mock('/users/9')).json(), { id: '9' });
  });
});

test('module sources cannot be written outside their directory', async () => {
  await withServer(async ({ admin }) => {
    const res = await admin(`/api/handlers/${encodeURIComponent('../../evil')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: '1;' }),
    });
    assert.equal(res.status, 400);
  });
});

test('an admin write does not trigger a reload loop', async () => {
  await withServer(async ({ admin, json }) => {
    const before = (await json('/api/status')).loadedAt;

    await admin('/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/once', response: { status: 200, body: {} } }),
    });

    const afterWrite = (await json('/api/status')).loadedAt;
    assert.notEqual(afterWrite, before, 'the write itself should reload once');

    // The watcher must not fire a second reload for our own write.
    await new Promise((r) => setTimeout(r, 900));
    assert.equal((await json('/api/status')).loadedAt, afterWrite);
  });
});

test('a load error clears once the module can load, without touching a file', async () => {
  await withServer(
    async ({ mock, json, project }) => {
      // The dependency does not exist yet, so the route fails to load.
      assert.equal((await mock('/users/1')).status, 500);
      const failing = await until(async () => {
        const s = await json('/api/status');
        return s.errors.length > 0 ? s : null;
      });
      assert.match(failing.errors[0].message, /Cannot find module/);

      // Installing it is enough — a failed load is never cached.
      project.write('node_modules/mockr-test-dep/package.json', { name: 'mockr-test-dep', main: 'index.js' });
      project.write('node_modules/mockr-test-dep/index.js', 'module.exports = { id: () => "ok" };');

      const res = await until(async () => {
        const r = await mock('/users/1');
        return r.status === 200 ? r : null;
      });
      assert.deepEqual(await res.json(), { id: 'ok' });

      // And the recorded error clears, so the UI stops warning about it.
      const recovered = await json('/api/status');
      assert.equal(recovered.errors.length, 0);
      assert.equal(recovered.ok, true);
    },
    {
      'handlers/byId.js': `const dep = require('mockr-test-dep');\nmodule.exports = () => ({ status: 200, body: { id: dep.id() } });`,
    },
  );
});

test('built-in auth works end to end from config', async () => {
  const project = tempProject({
    'mockr.json': {
      interceptors: { '@jwt': { secret: '${TEST_JWT_SECRET}' }, '@apiKey': { key: 'sk_1' } },
      handlers: { '@jwt.sign': { secret: '${TEST_JWT_SECRET}', expiresInSeconds: 60 } },
      routes: [
        { id: 'r_login', method: 'POST', path: '/login', handler: '@jwt.sign' },
        { id: 'r_me', method: 'GET', path: '/me', handler: 'whoami', request: { interceptors: ['@jwt'] } },
        {
          id: 'r_paid',
          method: 'GET',
          path: '/paid',
          response: { status: 200, body: { ok: true } },
          request: { interceptors: ['@apiKey'] },
        },
      ],
    },
    'handlers/whoami.js': 'module.exports = (ctx) => ({ body: { sub: ctx.request.user.sub } });',
  });

  process.env.TEST_JWT_SECRET = 'integration-secret';
  const server = await start({
    dir: project.dir,
    port: 0,
    adminPort: 0,
    host: '127.0.0.1',
    cors: true,
    quiet: true,
    silent: true,
    uiDir: null,
  });
  const mock = (p, init) => fetch(`http://127.0.0.1:${server.mockPort}${p}`, init);

  try {
    assert.equal((await mock('/me')).status, 401);

    const issued = await mock('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: '42' }),
    });
    const { token } = await issued.json();

    const me = await mock('/me', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { sub: '42' });

    assert.equal((await mock('/paid')).status, 401);
    assert.equal((await mock('/paid', { headers: { 'x-api-key': 'sk_1' } })).status, 200);
  } finally {
    await server.close();
    project.cleanup();
    delete process.env.TEST_JWT_SECRET;
  }
});

test('a built-in missing its configuration is reported, not left to fail per request', async () => {
  const project = tempProject({
    'mockr.json': {
      routes: [
        {
          id: 'r_x',
          method: 'GET',
          path: '/x',
          response: { status: 200 },
          request: { interceptors: ['@jwt'] },
        },
      ],
    },
  });

  const server = await start({
    dir: project.dir,
    port: 0,
    adminPort: 0,
    host: '127.0.0.1',
    cors: true,
    quiet: true,
    silent: true,
    uiDir: null,
  });

  try {
    const status = server.registry.status();
    assert.equal(status.ok, false);
    assert.match(
      status.errors.map((e) => e.message).join(),
      /needs a "secret" — set it under "interceptors"/,
    );
  } finally {
    await server.close();
    project.cleanup();
  }
});

test('an unknown built-in is rejected by name', async () => {
  const project = tempProject({
    'mockr.json': {
      routes: [
        {
          id: 'r_x',
          method: 'GET',
          path: '/x',
          response: { status: 200 },
          request: { interceptors: ['@nope'] },
        },
      ],
    },
  });

  const server = await start({
    dir: project.dir,
    port: 0,
    adminPort: 0,
    host: '127.0.0.1',
    cors: true,
    quiet: true,
    silent: true,
    uiDir: null,
  });

  try {
    assert.match(
      server.registry
        .status()
        .errors.map((e) => e.message)
        .join(),
      /unknown built-in/,
    );
  } finally {
    await server.close();
    project.cleanup();
  }
});

test('user interceptors receive their configured settings', async () => {
  const project = tempProject({
    'mockr.json': {
      interceptors: { tagger: { tag: 'from-config' } },
      routes: [
        {
          id: 'r_x',
          method: 'GET',
          path: '/x',
          response: { status: 200, body: {} },
          request: { interceptors: ['tagger'] },
        },
      ],
    },
    'interceptors/tagger.js':
      'module.exports = (ctx, config) => { ctx.response = { status: 200, headers: {}, body: { tag: config.tag } }; };',
  });

  const server = await start({
    dir: project.dir,
    port: 0,
    adminPort: 0,
    host: '127.0.0.1',
    cors: true,
    quiet: true,
    silent: true,
    uiDir: null,
  });

  try {
    const res = await fetch(`http://127.0.0.1:${server.mockPort}/x`);
    assert.deepEqual(await res.json(), { tag: 'from-config' });
  } finally {
    await server.close();
    project.cleanup();
  }
});
