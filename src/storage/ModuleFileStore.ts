import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { MODULE_EXTENSIONS, findModuleFile, resolveModuleBase, scaffoldExtension } from '../util/paths';

export type ModuleKind = 'handlers' | 'interceptors';

export interface ModuleFile {
  name: string;
  file: string;
  ext: string;
  source: string;
}

/** Names are filenames — keep them boring, and never path-like. */
const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class InvalidModuleName extends Error {}
export class ModuleSyntaxError extends Error {}

/**
 * Reads and writes the user's handler and interceptor files.
 *
 * The admin API is unauthenticated and local, but names still arrive from the
 * network, so they are validated as plain filenames and the resolved path is
 * checked to stay inside its directory.
 */
export class ModuleFileStore {
  constructor(
    private projectDir: string,
    private baseDir: string,
  ) {}

  private assertName(name: string): void {
    if (!VALID_NAME.test(name) || MODULE_EXTENSIONS.some((e) => name.endsWith(e))) {
      throw new InvalidModuleName(
        `"${name}" is not a valid module name — use letters, digits, dashes or underscores, without an extension`,
      );
    }
  }

  list(): string[] {
    if (!fs.existsSync(this.baseDir)) return [];

    const names = new Set<string>();
    for (const file of fs.readdirSync(this.baseDir)) {
      if (file.startsWith('.')) continue;
      const ext = MODULE_EXTENSIONS.find((e) => file.endsWith(e));
      if (ext) names.add(file.slice(0, -ext.length));
    }
    return [...names].sort();
  }

  async read(name: string): Promise<ModuleFile | null> {
    this.assertName(name);
    const file = findModuleFile(this.baseDir, name);
    if (!file) return null;

    return {
      name,
      file,
      ext: path.extname(file),
      source: await fsp.readFile(file, 'utf8'),
    };
  }

  /**
   * Create or overwrite a module. An existing file keeps its extension;
   * a new one gets whatever this project needs (.cjs when ESM).
   */
  async write(name: string, source: string): Promise<ModuleFile> {
    this.assertName(name);
    assertParses(source, name);

    const existing = findModuleFile(this.baseDir, name);
    const file = existing ?? resolveModuleBase(this.baseDir, name) + scaffoldExtension(this.projectDir);

    await fsp.mkdir(path.dirname(file), { recursive: true });

    // Atomic, so the watcher never observes a half-written module.
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, source, 'utf8');
    await fsp.rename(tmp, file);

    return { name, file, ext: path.extname(file), source };
  }

  async remove(name: string): Promise<boolean> {
    this.assertName(name);
    const file = findModuleFile(this.baseDir, name);
    if (!file) return false;
    await fsp.unlink(file);
    return true;
  }
}

/**
 * Reject code that cannot parse, so a typo never reaches the route table.
 * This is syntax only — the module is not executed here.
 */
function assertParses(source: string, name: string): void {
  try {
    new vm.Script(source, { filename: `${name}.js` });
  } catch (err) {
    throw new ModuleSyntaxError((err as Error).message);
  }
}
