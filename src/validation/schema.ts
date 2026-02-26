import { HTTP_METHODS } from '../types';

export const routeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['method', 'path'],
  properties: {
    id: { type: 'string', minLength: 1 },
    method: { type: 'string', enum: HTTP_METHODS },
    path: { type: 'string', pattern: '^/' },
    request: {
      type: 'object',
      additionalProperties: false,
      properties: {
        interceptors: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    },
    response: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'integer', minimum: 100, maximum: 599 },
        delayMs: { type: 'integer', minimum: 0 },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: {},
        interceptors: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    },
    handler: { type: 'string', minLength: 1 },
  },
} as const;

export const configSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['routes'],
  properties: {
    routes: { type: 'array', items: routeSchema },
  },
} as const;
