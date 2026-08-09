import { Interceptor } from '../types';
import { ModuleLoader } from './ModuleLoader';
import { ProjectPaths } from '../util/paths';
import { BUILTIN_INTERCEPTORS } from '../builtin';

export class InterceptorLoader extends ModuleLoader<Interceptor> {
  constructor(paths: ProjectPaths) {
    super(paths.interceptorsDir, 'interceptor');
  }

  protected createBuiltin(name: string, config: Record<string, unknown>): Interceptor {
    const builtin = BUILTIN_INTERCEPTORS[name];
    if (!builtin) {
      throw new Error(
        `unknown built-in interceptor — available: ${Object.keys(BUILTIN_INTERCEPTORS).join(', ')}`,
      );
    }
    return builtin.create(config);
  }
}
