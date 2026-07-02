import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MockRoute, MockrConfig, ServerConfig } from '../types';
import { ProjectPaths } from '../util/paths';

export function hashContent(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex');
}

export function generateRouteId(): string {
  return 'r_' + crypto.randomBytes(3).toString('hex');
}

export interface ReadResult {
  config: MockrConfig;
  /** True when ids were backfilled and the file was rewritten. */
  rewritten: boolean;
}

/**
 * Reads and writes mockr.json.
 * Writes are atomic (tmp + rename) and remember their own content hash so the
 * file watcher can ignore the change it just caused.
 */
export class JsonFileStore {
  private lastWriteHash: string | null = null;

  constructor(private paths: ProjectPaths) {}

  /** True if this content is what we ourselves just wrote. */
  isSelfWrite(content: string): boolean {
    return this.lastWriteHash !== null && hashContent(content) === this.lastWriteHash;
  }

  async read(): Promise<ReadResult> {
    const raw = await fs.readFile(this.paths.configFile, 'utf8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`mockr.json is not valid JSON: ${(err as Error).message}`);
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as MockrConfig).routes)) {
      throw new Error('mockr.json must be an object with a "routes" array');
    }

    const config = parsed as MockrConfig;

    // Ids are server-owned: backfill any that are missing, then persist.
    const missing = config.routes.filter((r) => typeof r.id !== 'string' || r.id.length === 0);
    if (missing.length > 0) {
      const taken = new Set(config.routes.map((r) => r.id).filter(Boolean));
      for (const route of missing) {
        let id = generateRouteId();
        while (taken.has(id)) id = generateRouteId();
        taken.add(id);
        route.id = id;
      }
      await this.write(config);
      return { config, rewritten: true };
    }

    return { config, rewritten: false };
  }

  async getRoutes(): Promise<MockRoute[]> {
    const { config } = await this.read();
    return config.routes;
  }

  /**
   * Replace the routes, preserving everything else in the file.
   *
   * mockr.json is the user's file and holds their server settings too;
   * writing { routes } alone would silently delete them on the next save.
   */
  async saveRoutes(routes: MockRoute[]): Promise<void> {
    let existing: MockrConfig;
    try {
      existing = (await this.read()).config;
    } catch {
      existing = { routes: [] };
    }
    await this.write({ ...existing, routes });
  }

  /** Server settings as written in the file, or {} if unreadable. */
  async readServerConfig(): Promise<ServerConfig> {
    try {
      return (await this.read()).config.server ?? {};
    } catch {
      return {};
    }
  }

  /** Atomic write: a crash mid-write must never truncate the user's config. */
  async write(config: MockrConfig): Promise<void> {
    const content = JSON.stringify(config, null, 2) + '\n';
    this.lastWriteHash = hashContent(content);

    const tmp = path.join(this.paths.dir, `.mockr.json.${process.pid}.tmp`);
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, this.paths.configFile);
  }

  exists(): boolean {
    return fsSync.existsSync(this.paths.configFile);
  }
}
