export function isWriteDeleteClassification(classificationReason: string): boolean {
  const lower = classificationReason.toLowerCase();
  return (
    lower.includes('side-effectful prefix') ||
    lower.includes('destructive behavior') ||
    lower.includes('destructivehint')
  );
}

export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[schema not serializable]';
  }
}
