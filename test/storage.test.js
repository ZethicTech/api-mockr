const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JsonFileStore } = require('../dist/storage/JsonFileStore');
const { projectPaths } = require('../dist/util/paths');
const { tempProject } = require('./helpers');

function store(files) {
  const project = tempProject(files);
  return { project, store: new JsonFileStore(projectPaths(project.dir)) };
}

test('reads routes from mockr.json', async () => {
  const { project, store: s } = store({
    'mockr.json': { routes: [{ id: 'a', method: 'GET', path: '/x', response: { status: 200 } }] },
  });
  try {
    const routes = await s.getRoutes();
    assert.equal(routes.length, 1);
    assert.equal(routes[0].path, '/x');
  } finally {
    project.cleanup();
  }
});

test('backfills missing ids and rewrites the file once', async () => {
  const { project, store: s } = store({
    'mockr.json': { routes: [{ method: 'GET', path: '/x', response: { status: 200 } }] },
  });
  try {
    const first = await s.read();
    assert.equal(first.rewritten, true);
    assert.match(first.config.routes[0].id, /^r_[0-9a-f]{6}$/);

    // The id is now persisted, so a second read is a no-op.
    const second = await s.read();
    assert.equal(second.rewritten, false);
    assert.equal(second.config.routes[0].id, first.config.routes[0].id);
  } finally {
    project.cleanup();
  }
});

test('backfilled ids are unique', async () => {
  const { project, store: s } = store({
    'mockr.json': {
      routes: Array.from({ length: 25 }, (_, i) => ({
        method: 'GET',
        path: `/r${i}`,
        response: { status: 200 },
      })),
    },
  });
  try {
    const { config } = await s.read();
    const ids = new Set(config.routes.map((r) => r.id));
    assert.equal(ids.size, config.routes.length);
  } finally {
    project.cleanup();
  }
});

test('throws a clear error for unparseable JSON', async () => {
  const { project, store: s } = store({ 'mockr.json': '{ "routes": [ BROKEN' });
  try {
    await assert.rejects(() => s.read(), /not valid JSON/);
  } finally {
    project.cleanup();
  }
});

test('throws when routes is not an array', async () => {
  const { project, store: s } = store({ 'mockr.json': { routes: 'nope' } });
  try {
    await assert.rejects(() => s.read(), /"routes" array/);
  } finally {
    project.cleanup();
  }
});

test('saveRoutes writes readable, formatted JSON', async () => {
  const { project, store: s } = store({ 'mockr.json': { routes: [] } });
  try {
    await s.saveRoutes([{ id: 'a', method: 'POST', path: '/y', response: { status: 201 } }]);
    const raw = project.read('mockr.json');
    assert.match(raw, /\n {2}"routes"/);
    assert.equal(raw.endsWith('\n'), true);
    assert.deepEqual(JSON.parse(raw).routes[0].path, '/y');
  } finally {
    project.cleanup();
  }
});

test('writes leave no temp files behind', async () => {
  const { project, store: s } = store({ 'mockr.json': { routes: [] } });
  try {
    await s.saveRoutes([{ id: 'a', method: 'GET', path: '/x', response: { status: 200 } }]);
    const leftovers = fs.readdirSync(project.dir).filter((f) => f.includes('.tmp'));
    assert.deepEqual(leftovers, []);
  } finally {
    project.cleanup();
  }
});

test('recognises its own write so the watcher can ignore it', async () => {
  const { project, store: s } = store({ 'mockr.json': { routes: [] } });
  try {
    await s.saveRoutes([{ id: 'a', method: 'GET', path: '/x', response: { status: 200 } }]);
    assert.equal(s.isSelfWrite(project.read('mockr.json')), true);
    assert.equal(s.isSelfWrite('{"routes":[]}'), false);
  } finally {
    project.cleanup();
  }
});
