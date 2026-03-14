const test = require('node:test');
const assert = require('node:assert/strict');
const { RouteMatcher } = require('../dist/matcher/RouteMatcher');
const { normalizePath } = require('../dist/matcher/normalize');

const route = (method, path, id = path) => ({ id, method, path, response: { status: 200 } });

test('normalizePath strips query and trailing slashes', () => {
  assert.equal(normalizePath('/users?page=2'), '/users');
  assert.equal(normalizePath('/users/'), '/users');
  assert.equal(normalizePath('/users///'), '/users');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('users'), '/users');
});

test('matches a literal path', () => {
  const m = new RouteMatcher([route('GET', '/users')]);
  assert.ok(m.match('GET', '/users'));
  assert.equal(m.match('POST', '/users'), undefined);
  assert.equal(m.match('GET', '/other'), undefined);
});

test('method is case-insensitive, path is not', () => {
  const m = new RouteMatcher([route('GET', '/Users')]);
  assert.ok(m.match('get', '/Users'));
  assert.equal(m.match('GET', '/users'), undefined);
});

test('extracts path parameters', () => {
  const m = new RouteMatcher([route('GET', '/orders/:orderId/items/:itemId')]);
  const found = m.match('GET', '/orders/7/items/99');
  assert.deepEqual(found.params, { orderId: '7', itemId: '99' });
});

test('decodes percent-encoded parameters', () => {
  const m = new RouteMatcher([route('GET', '/users/:name')]);
  assert.equal(m.match('GET', '/users/ada%20lovelace').params.name, 'ada lovelace');
});

test('static segments outrank parameters regardless of declaration order', () => {
  const m = new RouteMatcher([route('GET', '/users/:id', 'param'), route('GET', '/users/me', 'static')]);
  assert.equal(m.match('GET', '/users/me').route.id, 'static');
  assert.equal(m.match('GET', '/users/42').route.id, 'param');
});

test('segment count must match exactly — no implicit wildcards', () => {
  const m = new RouteMatcher([route('GET', '/users/:id')]);
  assert.equal(m.match('GET', '/users'), undefined);
  assert.equal(m.match('GET', '/users/1/extra'), undefined);
});

test('HEAD falls back to the matching GET route', () => {
  const m = new RouteMatcher([route('GET', '/users')]);
  assert.equal(m.match('HEAD', '/users').route.id, '/users');
});

test('an explicit HEAD route wins over the GET fallback', () => {
  const m = new RouteMatcher([route('GET', '/users', 'get'), route('HEAD', '/users', 'head')]);
  assert.equal(m.match('HEAD', '/users').route.id, 'head');
});

test('matches the root path', () => {
  const m = new RouteMatcher([route('GET', '/')]);
  assert.ok(m.match('GET', '/'));
});
