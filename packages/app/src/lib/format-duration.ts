export function formatCompactOneDecimal(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

export function formatTokenCount(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : 'n/a';
}

export function formatDurationShort(
  totalSeconds: number,
  options?: { nonPositiveLabel?: string }
): string {
  const nonPositiveLabel = options?.nonPositiveLabel ?? '0s';
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return nonPositiveLabel;

  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
