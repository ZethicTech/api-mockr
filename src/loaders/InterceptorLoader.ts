import { Interceptor } from '../types';
import { ModuleLoader } from './ModuleLoader';
import { ProjectPaths } from '../util/paths';

export class InterceptorLoader extends ModuleLoader<Interceptor> {
  constructor(paths: ProjectPaths) {
    super(paths.interceptorsDir, 'interceptor');
  }
}
