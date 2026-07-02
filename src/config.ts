import { ResolvedServerConfig, SERVER_DEFAULTS, ServerConfig } from './types';

export type ConfigSource = 'default' | 'file' | 'flag';

export interface ResolvedConfig {
  values: ResolvedServerConfig;
  /** Where each value came from, for reporting at startup. */
  sources: Record<keyof ResolvedServerConfig, ConfigSource>;
}

/**
 * Resolve server settings: flags beat mockr.json, which beats the defaults.
 *
 * Only keys actually present in each layer count, so an absent flag never
 * silently overrides the project's own configuration.
 */
export function resolveConfig(file: ServerConfig = {}, flags: ServerConfig = {}): ResolvedConfig {
  const values: ResolvedServerConfig = { ...SERVER_DEFAULTS };
  const sources = {} as Record<keyof ResolvedServerConfig, ConfigSource>;

  for (const key of Object.keys(SERVER_DEFAULTS) as (keyof ResolvedServerConfig)[]) {
    sources[key] = 'default';

    const fromFile = file[key];
    if (fromFile !== undefined) {
      (values[key] as unknown) = fromFile;
      sources[key] = 'file';
    }

    const fromFlag = flags[key];
    if (fromFlag !== undefined) {
      (values[key] as unknown) = fromFlag;
      sources[key] = 'flag';
    }
  }

  return { values, sources };
}

/** Settings that only take effect at startup, for change reporting. */
export const RESTART_REQUIRED: (keyof ResolvedServerConfig)[] = ['port', 'adminPort', 'host'];

export function describeConflict(config: ResolvedConfig): string | null {
  if (config.values.port !== config.values.adminPort) return null;
  return `port and adminPort are both ${config.values.port} — they must differ`;
}
