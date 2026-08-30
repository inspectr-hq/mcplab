export function toComparableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}
