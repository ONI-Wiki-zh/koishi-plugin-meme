export function errMsg(e: unknown): string {
  console.warn(e);
  if (e instanceof Error) return e.message || e.name || 'Error';
  if (typeof e === 'string') return e.split('\n')[0];
  return `${e}`;
}
