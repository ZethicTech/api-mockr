#!/usr/bin/env node
import { parseArgs, HELP } from './args';
import { start } from '../app';
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

  const logger = new Logger({ quiet: opts.quiet });

  if (opts.command === 'init') {
    const paths = projectPaths(opts.dir);
    const { created } = scaffold(paths);
    if (created.length === 0) {
      console.log('Nothing to do — this project is already set up.');
    } else {
      console.log(`Created a Mockr project in ${paths.dir}`);
      for (const file of created) console.log(`  + ${file}`);
      console.log('\nNext:  mockr');
    }
    return;
  }

  let running;
  try {
    running = await start(opts);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') {
      logger.error(`port already in use — try: mockr --port ${opts.port + 1}`);
    } else {
      logger.error('failed to start', e);
    }
    process.exit(1);
  }

  const status = running.registry.status();
  console.log('');
  console.log(`  mockr  ${status.routeCount} route(s)`);
  console.log('');
  running.logger.ready('mock', `http://${opts.host}:${running.mockPort}`);
  running.logger.ready('ui', `http://${opts.host}:${running.adminPort}`);
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
