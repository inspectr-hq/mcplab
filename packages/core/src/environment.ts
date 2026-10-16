/** Read the first non-empty backend environment variable from one name or ordered aliases. */
export function readEnvironmentVariable(names: string | readonly string[]): string | undefined {
  for (const name of typeof names === 'string' ? [names] : names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}
