/**
 * Resolve a complete `${VAR}` environment reference in a configuration value.
 * Plain values remain unchanged. This deliberately does not expand embedded
 * references or treat plain strings as environment variable names.
 */
export function resolveConfigValue(value: string, label: string): string {
  const envMatch = value.match(/^\$\{([^}]+)\}$/);
  if (!envMatch) return value;

  const resolved = process.env[envMatch[1]];
  if (!resolved) throw new Error(`Missing env var '${envMatch[1]}' for ${label}`);
  return resolved;
}
