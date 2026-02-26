/** Strip query string and normalize the trailing slash. Paths stay case-sensitive. */
export function normalizePath(rawPath: string): string {
  const q = rawPath.indexOf('?');
  let p = q === -1 ? rawPath : rawPath.slice(0, q);
  if (!p.startsWith('/')) p = '/' + p;
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export function normalizeMethod(method: string): string {
  return method.toUpperCase();
}

export function splitSegments(path: string): string[] {
  const p = normalizePath(path);
  return p === '/' ? [] : p.slice(1).split('/');
}
