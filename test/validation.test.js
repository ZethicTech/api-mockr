const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../dist/validation/validate');
const { projectPaths } = require('../dist/util/paths');
const { tempProject } = require('./helpers');

function check(routes, files = {}) {
  const project = tempProject(files);
  try {
    return validateConfig({ routes }, projectPaths(project.dir), { checkFiles: true });
  } finally {
    project.cleanup();
  }
}

const messages = (result) => result.issues.map((i) => i.message).join(' | ');

test('accepts a minimal static route', () => {
  const result = check([{ id: 'a', method: 'GET', path: '/users', response: { status: 200, body: {} } }]);
  assert.equal(result.ok, true, messages(result));
});

test('rejects a route defining both response and handler', () => {
  const result = check([
    { id: 'a', method: 'GET', path: '/x', handler: 'h', response: { status: 200 } },
  ], { 'handlers/h.js': 'module.exports = () => ({});' });
  assert.equal(result.ok, false);
  assert.match(messages(result), /cannot define both/);
});

test('rejects a route defining neither response nor handler', () => {
  const result = check([{ id: 'a', method: 'GET', path: '/x' }]);
  assert.match(messages(result), /must define either/);
});

test('rejects duplicate method and path', () => {
  const result = check([
    { id: 'a', method: 'GET', path: '/x', response: { status: 200 } },
    { id: 'b', method: 'GET', path: '/x/', response: { status: 200 } },
  ]);
  assert.match(messages(result), /duplicate route/);
});

test('the same path under different methods is allowed', () => {
  const result = check([
    { id: 'a', method: 'GET', path: '/x', response: { status: 200 } },
    { id: 'b', method: 'POST', path: '/x', response: { status: 200 } },
  ]);
  assert.equal(result.ok, true, messages(result));
});

test('rejects an unsupported method', () => {
  const result = check([{ id: 'a', method: 'TRACE', path: '/x', response: { status: 200 } }]);
  assert.equal(result.ok, false);
});

test('rejects a path not starting with a slash', () => {
  const result = check([{ id: 'a', method: 'GET', path: 'users', response: { status: 200 } }]);
  assert.equal(result.ok, false);
});

test('rejects wildcard paths', () => {
  const result = check([{ id: 'a', method: 'GET', path: '/files/*', response: { status: 200 } }]);
  assert.match(messages(result), /wildcard/);
});

test('rejects an unnamed path parameter', () => {
  const result = check([{ id: 'a', method: 'GET', path: '/users/:', response: { status: 200 } }]);
  assert.match(messages(result), /missing a name/);
});

test('rejects a status outside the valid range', () => {
  const result = check([{ id: 'a', method: 'GET', path: '/x', response: { status: 99 } }]);
  assert.equal(result.ok, false);
});

test('rejects a negative delay', () => {
  const result = check([{ id: 'a', method: 'GET', path: '/x', response: { status: 200, delayMs: -1 } }]);
  assert.equal(result.ok, false);
});

test('rejects unknown properties', () => {
  const result = check([{ id: 'a', method: 'GET', path: '/x', response: { status: 200 }, oops: true }]);
  assert.equal(result.ok, false);
});

test('reports a missing handler file', () => {
  const result = check([{ id: 'a', method: 'GET', path: '/x', handler: 'nope' }]);
  assert.match(messages(result), /handler "nope" not found/);
});

test('reports a missing interceptor file', () => {
  const result = check([
    { id: 'a', method: 'GET', path: '/x', response: { status: 200, interceptors: ['ghost'] } },
  ]);
  assert.match(messages(result), /interceptor "ghost" not found/);
});

test('refuses module names escaping their directory', () => {
  const result = check([{ id: 'a', method: 'GET', path: '/x', handler: '../../etc/passwd' }]);
  assert.match(messages(result), /resolves outside/);
});

test('collects every issue rather than stopping at the first', () => {
  const result = check([
    { id: 'a', method: 'GET', path: '/x' },
    { id: 'b', method: 'GET', path: '/y', handler: 'missing' },
    { id: 'c', method: 'GET', path: '/x', response: { status: 200 } },
  ]);
  assert.ok(result.issues.length >= 3, `expected 3+ issues, got: ${messages(result)}`);
});
