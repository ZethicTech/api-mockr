import { ServerConfig } from '../types';

export interface CliOptions {
  command: 'start' | 'init' | 'help' | 'version';
  dir: string;
  /**
   * Only the settings actually passed on the command line.
   *
   * Keeping this partial is what lets mockr.json hold the project's settings:
   * a default filled in here would be indistinguishable from a real flag and
   * would override the file every time.
   */
  overrides: ServerConfig;
  open: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    command: 'start',
    dir: process.cwd(),
    overrides: {},
    open: true,
  };

  const args = [...argv];

  if (args[0] && !args[0].startsWith('-')) {
    const command = args.shift()!;
    if (command === 'init') opts.command = 'init';
    else if (command === 'start') opts.command = 'start';
    else throw new Error(`unknown command "${command}"`);
  }

  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case '--port':
      case '-p':
        opts.overrides.port = requireNumber(arg, args.shift());
        break;
      case '--admin-port':
        opts.overrides.adminPort = requireNumber(arg, args.shift());
        break;
      case '--host':
        opts.overrides.host = requireValue(arg, args.shift());
        break;
      case '--dir':
      case '-d':
        opts.dir = requireValue(arg, args.shift());
        break;
      case '--cors':
        opts.overrides.cors = true;
        break;
      case '--no-cors':
        opts.overrides.cors = false;
        break;
      case '--quiet':
      case '-q':
        opts.overrides.quiet = true;
        break;
      case '--no-open':
        opts.open = false;
        break;
      case '--help':
      case '-h':
        opts.command = 'help';
        break;
      case '--version':
      case '-v':
        opts.command = 'version';
        break;
      default:
        throw new Error(`unknown option "${arg}"`);
    }
  }

  return opts;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('-')) throw new Error(`${flag} requires a value`);
  return value;
}

function requireNumber(flag: string, value: string | undefined): number {
  const raw = requireValue(flag, value);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`${flag} must be a port number`);
  return n;
}

export const HELP = `
  mockr — lightweight local mock API server

  Usage
    $ mockr [command] [options]

  Commands
    start            start the mock and admin servers  (default)
    init             scaffold mockr.json, handlers/, interceptors/

  Options
    -p, --port       mock server port                  default 4000
        --admin-port admin API + UI port               default 4100
        --host       bind address                      default 127.0.0.1
    -d, --dir        project directory                 default cwd
        --cors       enable permissive CORS            default on
        --no-cors    disable permissive CORS
        --no-open    do not open the browser
    -q, --quiet      suppress the request log
    -h, --help       show this help
    -v, --version    show the version

  Settings can also live in mockr.json, so they are shared with the project:

    {
      "server": { "port": 4000, "adminPort": 4100 },
      "routes": []
    }

  Flags win over the file, and the file wins over the defaults.

  Binding to a non-loopback --host exposes arbitrary local code execution
  to your network. Handlers and interceptors are not sandboxed.
`;
