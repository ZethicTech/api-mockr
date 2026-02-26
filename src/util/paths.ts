import path from 'node:path';

export interface ProjectPaths {
  dir: string;
  configFile: string;
  handlersDir: string;
  interceptorsDir: string;
}

export function projectPaths(dir: string): ProjectPaths {
  const root = path.resolve(dir);
  return {
    dir: root,
    configFile: path.join(root, 'mockr.json'),
    handlersDir: path.join(root, 'handlers'),
    interceptorsDir: path.join(root, 'interceptors'),
  };
}

/**
 * Resolve `<baseDir>/<name>.js`, refusing anything that escapes baseDir.
 * Names come from mockr.json, which the unauthenticated admin API can write.
 */
export function resolveModulePath(baseDir: string, name: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, `${name}.js`);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`"${name}" resolves outside ${path.basename(base)}/`);
  }
  return resolved;
}
