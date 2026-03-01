import { RouteHandler } from '../types';
import { ModuleLoader } from './ModuleLoader';
import { ProjectPaths } from '../util/paths';

export class HandlerLoader extends ModuleLoader<RouteHandler> {
  constructor(paths: ProjectPaths) {
    super(paths.handlersDir, 'handler');
  }
}
