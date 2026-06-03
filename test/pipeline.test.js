const test = require('node:test');
const assert = require('node:assert/strict');
const { Pipeline } = require('../dist/runtime/pipeline');
const { HandlerLoader } = require('../dist/loaders/HandlerLoader');
const { InterceptorLoader } = require('../dist/loaders/InterceptorLoader');
const { projectPaths } = require('../dist/util/paths');
const { tempProject } = require('./helpers');

function build(files) {
  const project = tempProject(files);
  const paths = projectPaths(project.dir);
  const pipeline = new Pipeline(new HandlerLoader(paths), new InterceptorLoader(paths));
  return { project, pipeline };
}

const request = (over = {}) => ({
  method: 'POST',
  path: '/x',
  query: {},
  headers: {},
  body: {},
  ...over,
});

const match = (route) => ({ route: { id: 'r', ...route }, params: route.params ?? {} });

test('returns a static response', async () => {
  const { project, pipeline } = build({});
  try {
    const out = await pipeline.execute(
      match({ method: 'GET', path: '/x', response: { status: 201, body: { a: 1 }, headers: { 'x-t': '1' } } }),
      request(),
    );
    assert.equal(out.status, 201);
    assert.deepEqual(out.body, { a: 1 });
    assert.equal(out.headers['x-t'], '1');
    assert.equal(out.via, 'static');
  } finally {
    project.cleanup();
  }
});

test('a static response defaults to 200, and to 204 with no body', async () => {
  const { project, pipeline } = build({});
  try {
    const withBody = await pipeline.execute(
      match({ method: 'GET', path: '/x', response: { body: { a: 1 } } }),
      request(),
    );
    assert.equal(withBody.status, 200);

    const without = await pipeline.execute(match({ method: 'GET', path: '/x', response: {} }), request());
    assert.equal(without.status, 204);
  } finally {
    project.cleanup();
  }
});

test('runs a handler and passes it the request context', async () => {
  const { project, pipeline } = build({
    'handlers/echo.js': `module.exports = (ctx) => ({
      status: 200,
      body: { got: ctx.request.body, id: ctx.request.params.id, q: ctx.request.query.page },
    });`,
  });
  try {
    const out = await pipeline.execute(
      { route: { id: 'r', method: 'POST', path: '/x/:id', handler: 'echo' }, params: { id: '7' } },
      request({ body: { hi: true }, query: { page: '2' } }),
    );
    assert.deepEqual(out.body, { got: { hi: true }, id: '7', q: '2' });
    assert.equal(out.via, 'handler:echo');
  } finally {
    project.cleanup();
  }
});

test('a handler returning nothing produces 204', async () => {
  const { project, pipeline } = build({ 'handlers/void.js': 'module.exports = () => {};' });
  try {
    const out = await pipeline.execute(match({ method: 'GET', path: '/x', handler: 'void' }), request());
    assert.equal(out.status, 204);
    assert.equal(out.body, undefined);
  } finally {
    project.cleanup();
  }
});

test('request interceptors mutate the context and their return value is ignored', async () => {
  const { project, pipeline } = build({
    'interceptors/tag.js': `module.exports = (ctx) => { ctx.request.body.tagged = true; return "ignored"; };`,
    'handlers/echo.js': 'module.exports = (ctx) => ({ body: ctx.request.body });',
  });
  try {
    const out = await pipeline.execute(
      match({ method: 'POST', path: '/x', handler: 'echo', request: { interceptors: ['tag'] } }),
      request({ body: {} }),
    );
    assert.deepEqual(out.body, { tagged: true });
  } finally {
    project.cleanup();
  }
});

test('a request interceptor setting ctx.response short-circuits the handler', async () => {
  const { project, pipeline } = build({
    'interceptors/auth.js': `module.exports = (ctx) => {
      if (!ctx.request.headers.authorization) {
        ctx.response = { status: 401, headers: {}, body: { error: 'unauthorized' } };
      }
    };`,
    'handlers/never.js': `module.exports = () => { throw new Error('handler must not run'); };`,
  });
  try {
    const route = match({ method: 'POST', path: '/x', handler: 'never', request: { interceptors: ['auth'] } });

    const blocked = await pipeline.execute(route, request());
    assert.equal(blocked.status, 401);
    assert.equal(blocked.via, 'short-circuit');

    const allowed = await pipeline.execute(
      match({ method: 'POST', path: '/x', handler: 'echo', request: { interceptors: ['auth'] } }),
      request({ headers: { authorization: 'Bearer t' } }),
    );
    assert.notEqual(allowed.status, 401);
  } finally {
    project.cleanup();
  }
});

test('a short-circuit skips the remaining request interceptors', async () => {
  const { project, pipeline } = build({
    'interceptors/stop.js': `module.exports = (ctx) => { ctx.response = { status: 403, headers: {}, body: {} }; };`,
    'interceptors/after.js': `module.exports = () => { throw new Error('must not run'); };`,
  });
  try {
    const out = await pipeline.execute(
      match({ method: 'GET', path: '/x', response: { status: 200 }, request: { interceptors: ['stop', 'after'] } }),
      request(),
    );
    assert.equal(out.status, 403);
  } finally {
    project.cleanup();
  }
});

test('response interceptors see the populated response', async () => {
  const { project, pipeline } = build({
    'interceptors/wrap.js': `module.exports = (ctx) => {
      ctx.response.body = { wrapped: ctx.response.body };
      ctx.response.headers['x-wrapped'] = '1';
    };`,
  });
  try {
    const out = await pipeline.execute(
      match({ method: 'GET', path: '/x', response: { status: 200, body: { a: 1 }, interceptors: ['wrap'] } }),
      request(),
    );
    assert.deepEqual(out.body, { wrapped: { a: 1 } });
    assert.equal(out.headers['x-wrapped'], '1');
  } finally {
    project.cleanup();
  }
});

test('a throwing request interceptor is a 400 and surfaces its message', async () => {
  const { project, pipeline } = build({
    'interceptors/bad.js': `module.exports = () => { throw new Error('email required'); };`,
  });
  try {
    const out = await pipeline.execute(
      match({ method: 'POST', path: '/x', response: { status: 200 }, request: { interceptors: ['bad'] } }),
      request(),
    );
    assert.equal(out.status, 400);
    assert.match(JSON.stringify(out.body), /email required/);
    assert.ok(out.error, 'an unexpected throw should be logged');
  } finally {
    project.cleanup();
  }
});

test('a throwing response interceptor is a 500, not a 400', async () => {
  const { project, pipeline } = build({
    'interceptors/bad.js': `module.exports = () => { throw new Error('encryption failed'); };`,
  });
  try {
    const out = await pipeline.execute(
      match({ method: 'GET', path: '/x', response: { status: 200, body: {}, interceptors: ['bad'] } }),
      request(),
    );
    assert.equal(out.status, 500);
  } finally {
    project.cleanup();
  }
});

test('err.status and err.body from user code win, without logging a stack', async () => {
  const { project, pipeline } = build({
    'interceptors/deny.js': `module.exports = () => {
      const e = new Error('bad signature');
      e.status = 403;
      e.body = { error: 'bad signature' };
      throw e;
    };`,
  });
  try {
    const out = await pipeline.execute(
      match({ method: 'POST', path: '/x', response: { status: 200 }, request: { interceptors: ['deny'] } }),
      request(),
    );
    assert.equal(out.status, 403);
    assert.deepEqual(out.body, { error: 'bad signature' });
    assert.equal(out.error, undefined, 'a deliberate status is not a fault');
  } finally {
    project.cleanup();
  }
});

test('a throwing handler is a 500 naming the handler', async () => {
  const { project, pipeline } = build({
    'handlers/boom.js': `module.exports = () => { throw new Error('kaboom'); };`,
  });
  try {
    const out = await pipeline.execute(match({ method: 'GET', path: '/x', handler: 'boom' }), request());
    assert.equal(out.status, 500);
    assert.equal(out.body.handler, 'boom');
    assert.match(out.body.message, /kaboom/);
  } finally {
    project.cleanup();
  }
});

test('a handler that fails to load is a 500 reporting the load error', async () => {
  const { project, pipeline } = build({ 'handlers/broken.js': 'module.exports = (' });
  try {
    const out = await pipeline.execute(match({ method: 'GET', path: '/x', handler: 'broken' }), request());
    assert.equal(out.status, 500);
    assert.equal(out.body.error, 'handler failed to load');
  } finally {
    project.cleanup();
  }
});

test('a module exporting a non-function fails to load', async () => {
  const { project, pipeline } = build({ 'handlers/obj.js': 'module.exports = { not: "a function" };' });
  try {
    const out = await pipeline.execute(match({ method: 'GET', path: '/x', handler: 'obj' }), request());
    assert.equal(out.status, 500);
    assert.match(out.body.message, /must export a function/);
  } finally {
    project.cleanup();
  }
});

test('delayMs delays the response', async () => {
  const { project, pipeline } = build({});
  try {
    const started = Date.now();
    await pipeline.execute(
      match({ method: 'GET', path: '/x', response: { status: 200, body: {}, delayMs: 120 } }),
      request(),
    );
    assert.ok(Date.now() - started >= 110, 'expected the delay to be applied');
  } finally {
    project.cleanup();
  }
});

test('interceptors run in declared order', async () => {
  const { project, pipeline } = build({
    'interceptors/a.js': `module.exports = (ctx) => { ctx.request.body.order = (ctx.request.body.order||'') + 'a'; };`,
    'interceptors/b.js': `module.exports = (ctx) => { ctx.request.body.order = (ctx.request.body.order||'') + 'b'; };`,
    'handlers/echo.js': 'module.exports = (ctx) => ({ body: ctx.request.body });',
  });
  try {
    const out = await pipeline.execute(
      match({ method: 'POST', path: '/x', handler: 'echo', request: { interceptors: ['a', 'b'] } }),
      request({ body: {} }),
    );
    assert.equal(out.body.order, 'ab');
  } finally {
    project.cleanup();
  }
});

test('a load failure reports the cause once, without a require stack', async () => {
  const { project, pipeline } = build({
    'interceptors/needsDep.js': `require('definitely-not-installed-anywhere');`,
  });
  try {
    const out = await pipeline.execute(
      match({ method: 'GET', path: '/x', response: { status: 200 }, request: { interceptors: ['needsDep'] } }),
      request(),
    );
    assert.equal(out.body.interceptor, 'needsDep');
    assert.match(out.body.error, /Cannot find module/);
    assert.equal(out.body.error.includes('\n'), false, 'the require stack should not be included');
    assert.equal(out.body.message, undefined, 'error and message should not duplicate each other');
  } finally {
    project.cleanup();
  }
});

test('a handler load failure keeps its label and reports the cause separately', async () => {
  const { project, pipeline } = build({
    'handlers/needsDep.js': `require('definitely-not-installed-anywhere');`,
  });
  try {
    const out = await pipeline.execute(match({ method: 'GET', path: '/x', handler: 'needsDep' }), request());
    assert.equal(out.body.error, 'handler failed to load');
    assert.match(out.body.message, /Cannot find module/);
  } finally {
    project.cleanup();
  }
});
