import { RouteHandler } from '../types';
import { ModuleLoader } from './ModuleLoader';
import { ProjectPaths } from '../util/paths';
import { BUILTIN_HANDLERS } from '../builtin';

export class HandlerLoader extends ModuleLoader<RouteHandler> {
  constructor(paths: ProjectPaths) {
    super(paths.handlersDir, 'handler');
  }

  protected createBuiltin(name: string, config: Record<string, unknown>): RouteHandler {
    const builtin = BUILTIN_HANDLERS[name];
    if (!builtin) {
      throw new Error(`unknown built-in handler — available: ${Object.keys(BUILTIN_HANDLERS).join(', ')}`);
    }
    return builtin.create(config);
  }
}
