const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveConfig, describeConflict } = require('../dist/config');
const { parseArgs } = require('../dist/cli/args');
const { SERVER_DEFAULTS } = require('../dist/types');
const { JsonFileStore } = require('../dist/storage/JsonFileStore');
const { projectPaths } = require('../dist/util/paths');
const { validateConfig } = require('../dist/validation/validate');
const { tempProject } = require('./helpers');

test('falls back to the defaults', () => {
  const { values, sources } = resolveConfig({}, {});
  assert.deepEqual(values, SERVER_DEFAULTS);
  assert.equal(sources.port, 'default');
});

test('mockr.json overrides the defaults', () => {
  const { values, sources } = resolveConfig({ port: 5555, quiet: true }, {});
  assert.equal(values.port, 5555);
  assert.equal(values.quiet, true);
  assert.equal(sources.port, 'file');
  assert.equal(values.adminPort, SERVER_DEFAULTS.adminPort, 'untouched keys keep their default');
});

test('a flag overrides the file, per key', () => {
  const { values, sources } = resolveConfig({ port: 5555, adminPort: 5556 }, { port: 6001 });
  assert.equal(values.port, 6001);
  assert.equal(sources.port, 'flag');
  assert.equal(values.adminPort, 5556, 'the file still supplies keys no flag set');
  assert.equal(sources.adminPort, 'file');
});

test('absent flags never override the file', () => {
  // The whole point of parsing flags into a partial: a default filled in at
  // parse time would be indistinguishable from a real flag.
  const parsed = parseArgs([]);
  assert.deepEqual(parsed.overrides, {});
  assert.equal(resolveConfig({ port: 5555 }, parsed.overrides).values.port, 5555);
});

test('parses both port flags', () => {
  const parsed = parseArgs(['--port', '4001', '--admin-port', '4101']);
  assert.deepEqual(parsed.overrides, { port: 4001, adminPort: 4101 });
});

test('parses -p as the mock port', () => {
  assert.equal(parseArgs(['-p', '9000']).overrides.port, 9000);
});

test('--no-cors and --quiet are recorded as explicit values', () => {
  assert.deepEqual(parseArgs(['--no-cors', '-q']).overrides, { cors: false, quiet: true });
});

test('rejects a non-numeric or out-of-range port', () => {
  assert.throws(() => parseArgs(['--port', 'abc']), /must be a port number/);
  assert.throws(() => parseArgs(['--port', '70000']), /must be a port number/);
  assert.throws(() => parseArgs(['--port']), /requires a value/);
});

test('rejects unknown options and commands', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
  assert.throws(() => parseArgs(['frobnicate']), /unknown command/);
});

test('identical ports are reported as a conflict', () => {
  assert.match(describeConflict(resolveConfig({}, { port: 4000, adminPort: 4000 })), /must differ/);
  assert.equal(describeConflict(resolveConfig({}, {})), null);
});

test('identical ports in mockr.json fail validation', () => {
  const project = tempProject({});
  try {
    const result = validateConfig(
      { server: { port: 4000, adminPort: 4000 }, routes: [] },
      projectPaths(project.dir),
    );
    assert.equal(result.ok, false);
    assert.match(result.issues.map((i) => i.message).join(' '), /must differ/);
  } finally {
    project.cleanup();
  }
});

test('an unknown server key is rejected', () => {
  const project = tempProject({});
  try {
    const result = validateConfig({ server: { prot: 4000 }, routes: [] }, projectPaths(project.dir));
    assert.equal(result.ok, false);
  } finally {
    project.cleanup();
  }
});

test('saving routes preserves the server block', async () => {
  const project = tempProject({
    'mockr.json': {
      server: { port: 5555, adminPort: 5556 },
      routes: [{ id: 'a', method: 'GET', path: '/x', response: { status: 200 } }],
    },
  });
  try {
    const store = new JsonFileStore(projectPaths(project.dir));
    await store.saveRoutes([{ id: 'a', method: 'GET', path: '/y', response: { status: 200 } }]);

    const written = JSON.parse(project.read('mockr.json'));
    assert.deepEqual(written.server, { port: 5555, adminPort: 5556 });
    assert.equal(written.routes[0].path, '/y');
  } finally {
    project.cleanup();
  }
});

test('readServerConfig returns {} when the file is unreadable', async () => {
  const project = tempProject({ 'mockr.json': '{ BROKEN' });
  try {
    assert.deepEqual(await new JsonFileStore(projectPaths(project.dir)).readServerConfig(), {});
  } finally {
    project.cleanup();
  }
});
