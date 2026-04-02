const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scaffold } = require('../dist/scaffold');
const { projectPaths, findModuleFile, isEsmProject } = require('../dist/util/paths');
const { HandlerLoader } = require('../dist/loaders/HandlerLoader');
const { tempProject } = require('./helpers');

test('detects an ESM project from the nearest package.json', () => {
  const esm = tempProject({ 'package.json': { name: 'a', type: 'module' } });
  const cjs = tempProject({ 'package.json': { name: 'b' } });
  const none = tempProject({});
  try {
    assert.equal(isEsmProject(esm.dir), true);
    assert.equal(isEsmProject(cjs.dir), false);
    assert.equal(isEsmProject(none.dir), false);
  } finally {
    esm.cleanup();
    cjs.cleanup();
    none.cleanup();
  }
});

test('scaffolds .cjs handlers in an ESM project', () => {
  const project = tempProject({ 'package.json': { name: 'a', type: 'module' } });
  try {
    const result = scaffold(projectPaths(project.dir));
    assert.equal(result.esm, true);
    assert.ok(fs.existsSync(path.join(project.dir, 'handlers/login.cjs')));
    assert.equal(fs.existsSync(path.join(project.dir, 'handlers/login.js')), false);
  } finally {
    project.cleanup();
  }
});

test('scaffolds .js handlers in a CommonJS project', () => {
  const project = tempProject({ 'package.json': { name: 'a' } });
  try {
    const result = scaffold(projectPaths(project.dir));
    assert.equal(result.esm, false);
    assert.ok(fs.existsSync(path.join(project.dir, 'handlers/login.js')));
  } finally {
    project.cleanup();
  }
});

test('a scaffolded ESM project loads its own handler', async () => {
  const project = tempProject({ 'package.json': { name: 'a', type: 'module' } });
  try {
    const paths = projectPaths(project.dir);
    scaffold(paths);
    const handler = new HandlerLoader(paths).load('login');
    const result = await handler({ request: { body: { email: 'a@b.c' }, headers: {}, params: {}, query: {} } });
    assert.equal(result.status, 200);
  } finally {
    project.cleanup();
  }
});

test('modules resolve by name across both extensions', () => {
  const project = tempProject({ 'handlers/a.js': 'module.exports = () => ({});', 'handlers/b.cjs': 'module.exports = () => ({});' });
  try {
    const dir = path.join(project.dir, 'handlers');
    assert.match(findModuleFile(dir, 'a'), /a\.js$/);
    assert.match(findModuleFile(dir, 'b'), /b\.cjs$/);
    assert.equal(findModuleFile(dir, 'c'), null);
  } finally {
    project.cleanup();
  }
});

test('.cjs wins when both extensions exist', () => {
  const project = tempProject({ 'handlers/dup.js': 'module.exports = () => ({});', 'handlers/dup.cjs': 'module.exports = () => ({});' });
  try {
    assert.match(findModuleFile(path.join(project.dir, 'handlers'), 'dup'), /dup\.cjs$/);
  } finally {
    project.cleanup();
  }
});

test('a CommonJS .js handler in an ESM project fails with an actionable message', () => {
  const project = tempProject({
    'package.json': { name: 'a', type: 'module' },
    'handlers/old.js': 'module.exports = () => ({});',
  });
  try {
    const loader = new HandlerLoader(projectPaths(project.dir));
    assert.throws(() => loader.load('old'), /Rename it to old\.cjs/);
  } finally {
    project.cleanup();
  }
});
