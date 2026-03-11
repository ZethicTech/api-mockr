import fs from 'node:fs';
import chokidar, { FSWatcher } from 'chokidar';
import { JsonFileStore } from '../storage/JsonFileStore';
import { ProjectPaths } from '../util/paths';
import { Logger } from '../util/logger';

export interface WatcherOptions {
  paths: ProjectPaths;
  store: JsonFileStore;
  logger: Logger;
  onReload: () => Promise<void>;
  debounceMs?: number;
}

/**
 * Watches mockr.json, handlers/ and interceptors/.
 *
 * Three hazards handled here:
 *  - partial writes  -> awaitWriteFinish, so we never parse a truncated file
 *  - burst saves     -> debounce, so a multi-file save is one reload
 *  - our own writes  -> content-hash check, so the admin API does not loop
 */
export function createWatcher(opts: WatcherOptions): FSWatcher {
  const { paths, store, logger } = opts;
  const debounceMs = opts.debounceMs ?? 100;

  const watcher = chokidar.watch(
    [paths.configFile, paths.handlersDir, paths.interceptorsDir],
    {
      ignoreInitial: true,
      ignored: (p: string) => p.includes('.tmp') || p.includes('node_modules'),
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 30 },
    },
  );

  let timer: NodeJS.Timeout | null = null;
  let pending = false;

  const schedule = (changed: string) => {
    // Ignore the write the admin API just made itself.
    if (changed === paths.configFile) {
      try {
        const content = fs.readFileSync(paths.configFile, 'utf8');
        if (store.isSelfWrite(content)) return;
      } catch {
        // Unreadable mid-write; let the reload report the real error.
      }
    }

    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      if (!pending) return;
      pending = false;
      try {
        await opts.onReload();
      } catch (err) {
        logger.error('reload failed', err as Error);
      }
    }, debounceMs);
  };

  watcher.on('add', schedule);
  watcher.on('change', schedule);
  watcher.on('unlink', schedule);
  watcher.on('error', (err) => logger.error('watcher error', err as Error));

  return watcher;
}
