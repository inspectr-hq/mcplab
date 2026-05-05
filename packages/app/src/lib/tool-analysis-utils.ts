export function isWriteDeleteClassification(classificationReason: string): boolean {
  const lower = classificationReason.toLowerCase();
  return (
    lower.includes('side-effectful prefix') ||
    lower.includes('destructive behavior') ||
    lower.includes('destructivehint') ||
    lower.includes('non-read-only behavior') ||
    lower.includes('readonlyhint: false') ||
    lower.includes('additive behavior')
  );
}

export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[schema not serializable]';
  }
}
