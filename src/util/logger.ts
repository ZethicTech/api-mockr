const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';

export interface LoggerOptions {
  quiet?: boolean;
  color?: boolean;
}

export class Logger {
  private quiet: boolean;
  private color: boolean;

  constructor(opts: LoggerOptions = {}) {
    this.quiet = opts.quiet ?? false;
    this.color = opts.color ?? process.stdout.isTTY === true;
  }

  private paint(code: string, text: string): string {
    return this.color ? `${code}${text}${RESET}` : text;
  }

  /** Live request log. Nothing is persisted — this is not request recording. */
  request(method: string, path: string, status: number, ms: number, via: string): void {
    if (this.quiet) return;
    const statusColor = status >= 500 ? RED : status >= 400 ? YELLOW : GREEN;
    const line = [
      this.paint(CYAN, method.padEnd(6)),
      path.padEnd(28),
      this.paint(statusColor, String(status)),
      this.paint(DIM, `${ms}ms`.padStart(7)),
      this.paint(DIM, via),
    ].join(' ');
    console.log(line);
  }

  info(message: string): void {
    if (this.quiet) return;
    console.log(message);
  }

  ready(label: string, url: string): void {
    console.log(`  ${this.paint(GREEN, '●')} ${label.padEnd(6)} ${this.paint(BLUE, url)}`);
  }

  warn(message: string): void {
    console.warn(this.paint(YELLOW, `! ${message}`));
  }

  error(message: string, err?: Error): void {
    console.error(this.paint(RED, `✗ ${message}`));
    if (err?.stack) console.error(this.paint(DIM, err.stack));
  }

  reloaded(routeCount: number, errorCount: number): void {
    if (this.quiet) return;
    if (errorCount > 0) {
      this.warn(`reloaded with ${errorCount} error(s) — serving last valid state where needed`);
    } else {
      console.log(this.paint(DIM, `↻ reloaded — ${routeCount} route(s)`));
    }
  }
}
