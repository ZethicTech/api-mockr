const test = require('node:test');
const assert = require('node:assert/strict');
const { signJwt, verifyJwt, JwtError } = require('../dist/builtin/jwt');
const { BUILTIN_INTERCEPTORS, BUILTIN_HANDLERS } = require('../dist/builtin');
const { expandEnv } = require('../dist/util/env');

const SECRET = 'test-secret';
const ctx = (headers = {}, query = {}) => ({
  request: { method: 'GET', path: '/x', params: {}, query, headers, body: {} },
  route: { id: 'r', path: '/x' },
});

// ── jwt ─────────────────────────────────────────────────────────────────────

test('round-trips a signed token', () => {
  const payload = verifyJwt(signJwt({ sub: '1' }, { secret: SECRET }), { secret: SECRET });
  assert.equal(payload.sub, '1');
  assert.equal(typeof payload.iat, 'number');
});

test('rejects a token signed with a different secret', () => {
  const token = signJwt({ sub: '1' }, { secret: 'other' });
  assert.throws(() => verifyJwt(token, { secret: SECRET }), /invalid signature/);
});

test('rejects a tampered payload', () => {
  const [h, , s] = signJwt({ sub: 'user' }, { secret: SECRET }).split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url');
  assert.throws(() => verifyJwt(`${h}.${forged}.${s}`, { secret: SECRET }), /invalid signature/);
});

test('rejects alg:none', () => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b({ alg: 'none', typ: 'JWT' })}.${b({ sub: 'admin' })}.`;
  assert.throws(() => verifyJwt(token, { secret: SECRET }), /not allowed/);
});

test('rejects an algorithm outside the allowed list', () => {
  const token = signJwt({ sub: '1' }, { secret: SECRET, algorithm: 'HS512' });
  assert.throws(() => verifyJwt(token, { secret: SECRET, algorithms: ['HS256'] }), /not allowed/);
  assert.ok(verifyJwt(token, { secret: SECRET, algorithms: ['HS512'] }));
});

test('rejects an expired token and honours clock tolerance', () => {
  const token = signJwt({ sub: '1', exp: Math.floor(Date.now() / 1000) - 5 }, { secret: SECRET });
  assert.throws(() => verifyJwt(token, { secret: SECRET }), /expired/);
  assert.ok(verifyJwt(token, { secret: SECRET, clockTolerance: 60 }));
});

test('rejects a token that is not yet active', () => {
  const token = signJwt({ sub: '1', nbf: Math.floor(Date.now() / 1000) + 60 }, { secret: SECRET });
  assert.throws(() => verifyJwt(token, { secret: SECRET }), /not active/);
});

test('checks issuer and audience when asked', () => {
  const token = signJwt({ sub: '1', iss: 'mockr', aud: ['app'] }, { secret: SECRET });
  assert.ok(verifyJwt(token, { secret: SECRET, issuer: 'mockr', audience: 'app' }));
  assert.throws(() => verifyJwt(token, { secret: SECRET, issuer: 'other' }), /issuer/);
  assert.throws(() => verifyJwt(token, { secret: SECRET, audience: 'other' }), /audience/);
});

test('rejects malformed tokens', () => {
  for (const bad of ['', 'a.b', 'not-a-token', 'a.b.c.d']) {
    assert.throws(() => verifyJwt(bad, { secret: SECRET }), JwtError, `expected "${bad}" to be rejected`);
  }
});

test('expiresInSeconds sets exp', () => {
  const payload = verifyJwt(signJwt({ sub: '1' }, { secret: SECRET, expiresInSeconds: 60 }), {
    secret: SECRET,
  });
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
});

// ── @jwt interceptor ────────────────────────────────────────────────────────

const jwtInterceptor = (config = {}) => BUILTIN_INTERCEPTORS['@jwt'].create({ secret: SECRET, ...config });

test('@jwt attaches claims to ctx.request.user', async () => {
  const c = ctx({ authorization: `Bearer ${signJwt({ sub: '7' }, { secret: SECRET })}` });
  await jwtInterceptor()(c, {});
  assert.equal(c.response, undefined);
  assert.equal(c.request.user.sub, '7');
});

test('@jwt short-circuits with 401 when the token is missing or bad', async () => {
  const missing = ctx();
  await jwtInterceptor()(missing, {});
  assert.equal(missing.response.status, 401);

  const bad = ctx({ authorization: 'Bearer nonsense' });
  await jwtInterceptor()(bad, {});
  assert.equal(bad.response.status, 401);
});

test('@jwt requires the configured scheme', async () => {
  const c = ctx({ authorization: signJwt({ sub: '7' }, { secret: SECRET }) });
  await jwtInterceptor()(c, {});
  assert.match(c.response.body.error, /expected a Bearer token/);
});

test('@jwt optional lets an anonymous request through', async () => {
  const c = ctx();
  await jwtInterceptor({ optional: true })(c, {});
  assert.equal(c.response, undefined);
});

test('@jwt honours header and attachTo overrides', async () => {
  const c = ctx({ 'x-token': signJwt({ sub: '7' }, { secret: SECRET }) });
  await jwtInterceptor({ header: 'x-token', scheme: '', attachTo: 'claims' })(c, {});
  assert.equal(c.request.claims.sub, '7');
});

test('@jwt without a secret refuses to be created', () => {
  assert.throws(() => BUILTIN_INTERCEPTORS['@jwt'].create({}), /needs a "secret"/);
});

// ── @apiKey interceptor ─────────────────────────────────────────────────────

test('@apiKey accepts a matching key and rejects everything else', async () => {
  const create = (config) => BUILTIN_INTERCEPTORS['@apiKey'].create(config);

  const ok = ctx({ 'x-api-key': 'k1' });
  await create({ key: 'k1' })(ok, {});
  assert.equal(ok.response, undefined);

  const wrong = ctx({ 'x-api-key': 'nope' });
  await create({ key: 'k1' })(wrong, {});
  assert.equal(wrong.response.status, 401);

  const missing = ctx();
  await create({ key: 'k1' })(missing, {});
  assert.equal(missing.response.status, 401);
});

test('@apiKey supports multiple keys and a query parameter', async () => {
  const create = () => BUILTIN_INTERCEPTORS['@apiKey'].create({ keys: ['a', 'b'], query: 'api_key' });

  const second = ctx({ 'x-api-key': 'b' });
  await create()(second, {});
  assert.equal(second.response, undefined);

  const viaQuery = ctx({}, { api_key: 'a' });
  await create()(viaQuery, {});
  assert.equal(viaQuery.response, undefined);
});

// ── @jwt.sign handler ───────────────────────────────────────────────────────

test('@jwt.sign issues a verifiable token from the request body', async () => {
  const handler = BUILTIN_HANDLERS['@jwt.sign'].create({ secret: SECRET, expiresInSeconds: 60 });
  const c = ctx();
  c.request.body = { sub: '5', email: 'a@b.c' };

  const result = await handler(c, {});
  assert.equal(result.status, 200);

  const payload = verifyJwt(result.body.token, { secret: SECRET });
  assert.equal(payload.sub, '5');
  assert.equal(payload.email, 'a@b.c');
});

test('@jwt.sign merges configured claims under the request body', async () => {
  const handler = BUILTIN_HANDLERS['@jwt.sign'].create({ secret: SECRET, claims: { role: 'user', sub: 'default' } });
  const c = ctx();
  c.request.body = { sub: 'override' };

  const payload = verifyJwt((await handler(c, {})).body.token, { secret: SECRET });
  assert.equal(payload.role, 'user');
  assert.equal(payload.sub, 'override');
});

// ── config validation and env expansion ─────────────────────────────────────

test('built-in validators report what is missing', () => {
  assert.deepEqual(BUILTIN_INTERCEPTORS['@jwt'].validate({ secret: 's' }), []);
  assert.match(BUILTIN_INTERCEPTORS['@jwt'].validate({}).join(), /secret/);
  assert.match(BUILTIN_INTERCEPTORS['@jwt'].validate({ secret: 's', algorithms: ['RS256'] }).join(), /unsupported/);
  assert.match(BUILTIN_INTERCEPTORS['@apiKey'].validate({}).join(), /key/);
});

test('expandEnv replaces ${VAR} throughout a config block', () => {
  const expanded = expandEnv(
    { secret: '${S}', nested: { keys: ['${A}', 'literal'] }, count: 3, flag: true },
    { S: 'shh', A: 'k1' },
  );
  assert.deepEqual(expanded, { secret: 'shh', nested: { keys: ['k1', 'literal'] }, count: 3, flag: true });
});

test('an unset variable expands to empty, so validation reports it', () => {
  const expanded = expandEnv({ secret: '${NOT_SET}' }, {});
  assert.equal(expanded.secret, '');
  assert.match(BUILTIN_INTERCEPTORS['@jwt'].validate(expanded).join(), /secret/);
});
