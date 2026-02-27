const FEATURE_FLAG_PREFIX = 'mcplab.feature.';

export function isUiFeatureEnabled(flagName: string, defaultEnabled = false): boolean {
  if (typeof window === 'undefined') return defaultEnabled;
  try {
    const raw = window.localStorage.getItem(`${FEATURE_FLAG_PREFIX}${flagName}`);
    if (raw == null) return defaultEnabled;
    return raw === '1' || raw === 'true';
  } catch {
    return defaultEnabled;
  }
}
