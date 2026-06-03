const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Create a throwaway project directory; returns paths + a cleanup function. */
function tempProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockr-test-'));
  fs.mkdirSync(path.join(dir, 'handlers'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'interceptors'), { recursive: true });

  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }

  return {
    dir,
    file: (rel) => path.join(dir, rel),
    write: (rel, content) => {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    },
    read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn() is truthy, so reload tests are not flaky on slow machines. */
async function until(fn, timeoutMs = 4000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() > deadline) throw new Error('condition not met within timeout');
    await sleep(stepMs);
  }
}

module.exports = { tempProject, sleep, until };
