#!/usr/bin/env node
import { parseArgs, HELP } from './args';
import { readServerConfig, start } from '../app';
import { describeConflict, resolveConfig } from '../config';
import { projectPaths } from '../util/paths';
import { scaffold } from '../scaffold';
import { Logger } from '../util/logger';

const VERSION = '0.1.0';

async function main(): Promise<void> {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`mockr: ${(err as Error).message}`);
    console.error('Run `mockr --help` for usage.');
    process.exit(1);
  }

  if (opts.command === 'help') {
    console.log(HELP);
    return;
  }

  if (opts.command === 'version') {
    console.log(VERSION);
    return;
  }

  if (opts.command === 'init') {
    const paths = projectPaths(opts.dir);
    const { created, esm } = scaffold(paths);
    if (created.length === 0) {
      console.log('Nothing to do — this project is already set up.');
    } else {
      console.log(`Created a Mockr project in ${paths.dir}`);
      for (const file of created) console.log(`  + ${file}`);
      if (esm) console.log('\nThis project is ESM ("type": "module"), so handlers use .cjs');
      console.log('\nNext:  mockr');
    }
    return;
  }

  // Flags beat mockr.json, which beats the defaults.
  const config = resolveConfig(await readServerConfig(opts.dir), opts.overrides);
  const logger = new Logger({ quiet: config.values.quiet });

  const conflict = describeConflict(config);
  if (conflict) {
    logger.error(conflict);
    process.exit(1);
  }

  let running;
  try {
    running = await start({ dir: opts.dir, ...config.values });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') {
      logger.error(
        `port already in use — try: mockr --port ${config.values.port + 1} --admin-port ${config.values.adminPort + 1}`,
      );
    } else {
      logger.error('failed to start', e);
    }
    process.exit(1);
  }

  const status = running.registry.status();
  const from = (key: 'port' | 'adminPort') =>
    config.sources[key] === 'default' ? '' : `  (${config.sources[key]})`;

  console.log('');
  console.log(`  mockr  ${status.routeCount} route(s)`);
  console.log('');
  running.logger.ready('mock', `http://${config.values.host}:${running.mockPort}${from('port')}`);
  running.logger.ready('ui', `http://${config.values.host}:${running.adminPort}${from('adminPort')}`);
  console.log('');

  const shutdown = async () => {
    console.log('');
    await running.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
