const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ModuleFileStore, InvalidModuleName, ModuleSyntaxError } = require('../dist/storage/ModuleFileStore');
const { tempProject } = require('./helpers');

function build(files = {}) {
  const project = tempProject(files);
  return { project, store: new ModuleFileStore(project.dir, path.join(project.dir, 'handlers')) };
}

test('writes a new module and reads it back', async () => {
  const { project, store } = build();
  try {
    const written = await store.write('greet', 'module.exports = () => ({});');
    assert.equal(written.ext, '.js');
    assert.equal((await store.read('greet')).source, 'module.exports = () => ({});');
  } finally {
    project.cleanup();
  }
});

test('new modules use .cjs in an ESM project', async () => {
  const { project, store } = build({ 'package.json': { name: 'a', type: 'module' } });
  try {
    assert.equal((await store.write('greet', 'module.exports = () => ({});')).ext, '.cjs');
  } finally {
    project.cleanup();
  }
});

test('an existing module keeps its extension when edited', async () => {
  const { project, store } = build({
    'package.json': { name: 'a', type: 'module' },
    'handlers/legacy.js': 'module.exports = () => ({});',
  });
  try {
    const written = await store.write('legacy', 'module.exports = () => ({ edited: true });');
    assert.equal(written.ext, '.js');
    assert.equal(fs.existsSync(path.join(project.dir, 'handlers/legacy.cjs')), false);
  } finally {
    project.cleanup();
  }
});

test('rejects code that does not parse, leaving the old file intact', async () => {
  const { project, store } = build({ 'handlers/a.js': 'module.exports = () => ({ ok: true });' });
  try {
    await assert.rejects(() => store.write('a', 'module.exports = ('), ModuleSyntaxError);
    assert.match((await store.read('a')).source, /ok: true/);
  } finally {
    project.cleanup();
  }
});

test('rejects names that are paths or carry an extension', async () => {
  const { project, store } = build();
  try {
    for (const bad of ['../evil', 'a/b', '/abs', 'name.js', '.hidden', '']) {
      await assert.rejects(() => store.write(bad, '1;'), InvalidModuleName, `expected "${bad}" to be rejected`);
    }
  } finally {
    project.cleanup();
  }
});

test('reading an unknown module returns null', async () => {
  const { project, store } = build();
  try {
    assert.equal(await store.read('nope'), null);
  } finally {
    project.cleanup();
  }
});

test('lists modules across both extensions without duplicates', async () => {
  const { project, store } = build({
    'handlers/a.js': '1;',
    'handlers/b.cjs': '1;',
    'handlers/c.js': '1;',
    'handlers/c.cjs': '1;',
    'handlers/notes.txt': 'ignored',
    'handlers/.hidden.js': '1;',
  });
  try {
    assert.deepEqual(store.list(), ['a', 'b', 'c']);
  } finally {
    project.cleanup();
  }
});

test('removes a module', async () => {
  const { project, store } = build({ 'handlers/a.js': '1;' });
  try {
    assert.equal(await store.remove('a'), true);
    assert.equal(await store.remove('a'), false);
  } finally {
    project.cleanup();
  }
});

test('writes leave no temp files behind', async () => {
  const { project, store } = build();
  try {
    await store.write('a', 'module.exports = () => ({});');
    const junk = fs.readdirSync(path.join(project.dir, 'handlers')).filter((f) => f.includes('.tmp'));
    assert.deepEqual(junk, []);
  } finally {
    project.cleanup();
  }
});
