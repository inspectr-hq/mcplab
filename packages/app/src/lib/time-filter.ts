export type TimeFilterPreset =
  | '15min'
  | '30min'
  | '1h'
  | '2h'
  | '4h'
  | '8h'
  | '24h'
  | '7d'
  | '14d'
  | '30d';

export type TimeFilterMode = 'all' | 'last' | 'custom';

export type TimeFilterQueryState = {
  mode: TimeFilterMode;
  preset: TimeFilterPreset;
  start: string;
  end: string;
};

export const TIME_FILTER_PRESETS: Array<{
  value: TimeFilterPreset;
  label: string;
  durationMs: number;
}> = [
  { value: '15min', label: 'Last 15min', durationMs: 15 * 60 * 1000 },
  { value: '30min', label: 'Last 30min', durationMs: 30 * 60 * 1000 },
  { value: '1h', label: 'Last hour', durationMs: 60 * 60 * 1000 },
  { value: '2h', label: 'Last 2 hours', durationMs: 2 * 60 * 60 * 1000 },
  { value: '4h', label: 'Last 4 hours', durationMs: 4 * 60 * 60 * 1000 },
  { value: '8h', label: 'Last 8 hours', durationMs: 8 * 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 hours', durationMs: 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { value: '14d', label: 'Last 14 days', durationMs: 14 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: 'Last 30 days', durationMs: 30 * 24 * 60 * 60 * 1000 }
];

export function isTimeFilterMode(value: string | null): value is TimeFilterMode {
  return value === 'all' || value === 'last' || value === 'custom';
}

export function isTimeFilterPreset(value: string | null): value is TimeFilterPreset {
  return (
    value === '15min' ||
    value === '30min' ||
    value === '1h' ||
    value === '2h' ||
    value === '4h' ||
    value === '8h' ||
    value === '24h' ||
    value === '7d' ||
    value === '14d' ||
    value === '30d'
  );
}

export function getTimeFilterQueryState(searchParams: URLSearchParams): TimeFilterQueryState {
  const modeParam = searchParams.get('time_filter');
  const presetParam = searchParams.get('time_preset');
  return {
    mode: isTimeFilterMode(modeParam) ? modeParam : 'all',
    preset: isTimeFilterPreset(presetParam) ? presetParam : '15min',
    start: searchParams.get('time_start') ?? '',
    end: searchParams.get('time_end') ?? ''
  };
}
