export function formatFailureReason(reason: string): string {
  const trimmed = String(reason ?? '').trim();
  const regexMatch = trimmed.match(/^Regex assertion failed:\s*(.+)$/i);
  if (regexMatch) return `Text match failed: ${regexMatch[1]}`;
  return trimmed;
}
