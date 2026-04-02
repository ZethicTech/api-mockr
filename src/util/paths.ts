import fs from 'node:fs';
import path from 'node:path';

export interface ProjectPaths {
  dir: string;
  configFile: string;
  handlersDir: string;
  interceptorsDir: string;
}

/**
 * Extensions accepted for user modules, in preference order.
 *
 * .cjs comes first because it is unambiguous: in a project with
 * "type": "module" a .js file is ESM, and a CommonJS handler in one fails to
 * load. Mockr scaffolds .cjs for those projects and accepts both everywhere.
 */
export const MODULE_EXTENSIONS = ['.cjs', '.js'] as const;

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
 * Resolve `<baseDir>/<name>` without an extension, refusing anything that
 * escapes baseDir. Names come from mockr.json, which the unauthenticated
 * admin API can write.
 */
export function resolveModuleBase(baseDir: string, name: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, name);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`"${name}" resolves outside ${path.basename(base)}/`);
  }
  return resolved;
}

export function moduleCandidates(baseDir: string, name: string): string[] {
  const base = resolveModuleBase(baseDir, name);
  return MODULE_EXTENSIONS.map((ext) => base + ext);
}

/** The first candidate that exists, or null. */
export function findModuleFile(baseDir: string, name: string): string | null {
  for (const candidate of moduleCandidates(baseDir, name)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** True when the nearest package.json marks the project as ESM. */
export function isEsmProject(dir: string): boolean {
  let current = path.resolve(dir);

  for (;;) {
    const pkg = path.join(current, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        return JSON.parse(fs.readFileSync(pkg, 'utf8')).type === 'module';
      } catch {
        return false;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** The extension Mockr should scaffold for this project. */
export const scaffoldExtension = (dir: string): '.cjs' | '.js' => (isEsmProject(dir) ? '.cjs' : '.js');
