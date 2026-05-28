import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GitCompare,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ArrowLeftRight,
  Clock,
  CalendarRange,
  X
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { PassRateBadge } from '@/components/PassRateBadge';
import { formatProvider } from '@/components/ProviderBadge';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useDataSource } from '@/contexts/DataSourceContext';
import type { EvalResult, ScenarioResult, ScenarioRun } from '@/types/eval';
import { toast } from '@/hooks/use-toast';
import { buildRunScopeSummary, type RunScopeSummary } from '@/lib/run-scope-summary';
import { summaryToResult } from '@/lib/run-summary-to-result';
import { useOffsetPagination } from '@/hooks/use-offset-pagination';
import { formatDurationMs, getRunTotalDurationMs } from '@/lib/run-duration';

const colors = [
  'hsl(38, 92%, 50%)',
  'hsl(200, 80%, 50%)',
  'hsl(152, 69%, 40%)',
  'hsl(280, 60%, 50%)',
  'hsl(0, 72%, 51%)'
];

type CompareMode = 'runs' | 'within-run';
type TimeFilterPreset = '15min' | '30min' | '1h' | '24h' | '7d' | '14d' | '30d';
type TimeFilterMode = 'all' | 'last' | 'custom';
type TimeFilterQueryState = {
  mode: TimeFilterMode;
  preset: TimeFilterPreset;
  start: string;
  end: string;
};

type AgentSummary = {
  agentId: string;
  agentName: string;
  provider?: string;
  model?: string;
  passRate: number;
  totalRuns: number;
  avgToolCalls: number;
  avgLatency: number;
};

type WithinRunScenarioRow = {
  scenarioId: string;
  scenarioName: string;
  displayLabel: string;
  byAgent: Record<string, ScenarioResult | undefined>;
};

type CompareTableItem =
  | { type: 'day-separator'; dayKey: string; dayLabel: string }
  | { type: 'run'; run: EvalResult };

const COMPARE_RUNS_TABLE_COLUMN_COUNT = 8;
const COMPARE_DAY_SEPARATOR_STORAGE_KEY = 'mcplab.compare.showDaySeparators';

const TIME_FILTER_PRESETS: Array<{ value: TimeFilterPreset; label: string; durationMs: number }> = [
  { value: '15min', label: 'Last 15min', durationMs: 15 * 60 * 1000 },
  { value: '30min', label: 'Last 30min', durationMs: 30 * 60 * 1000 },
  { value: '1h', label: 'Last hour', durationMs: 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 hours', durationMs: 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { value: '14d', label: 'Last 14 days', durationMs: 14 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: 'Last 30 days', durationMs: 30 * 24 * 60 * 60 * 1000 }
];

function parseLocalDateTime(value: string) {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatLocalDateTime(value: string) {
  const parsed = parseLocalDateTime(value);
  if (!parsed) return '';
  return parsed.toLocaleString();
}

function getLocalDayKey(value: string) {
  const parsed = parseLocalDateTime(value);
  if (!parsed) return value;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMcpServersWithVersions(mcpServerVersions: Record<string, string | null>): string {
  const entries = Object.entries(mcpServerVersions ?? {});
  if (entries.length === 0) return '—';
  return entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([server, version]) => `${server}@${version ?? 'unknown'}`)
    .join(', ');
}

function formatLocalDayLabel(value: string) {
  const parsed = parseLocalDateTime(value);
  if (!parsed) return 'Unknown day';
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function isTimeFilterMode(value: string | null): value is TimeFilterMode {
  return value === 'all' || value === 'last' || value === 'custom';
}

function isTimeFilterPreset(value: string | null): value is TimeFilterPreset {
  return (
    value === '15min' ||
    value === '30min' ||
    value === '1h' ||
    value === '24h' ||
    value === '7d' ||
    value === '14d' ||
    value === '30d'
  );
}

function getTimeFilterQueryState(searchParams: URLSearchParams): TimeFilterQueryState {
  const modeParam = searchParams.get('time_filter');
  const presetParam = searchParams.get('time_preset');
  return {
    mode: isTimeFilterMode(modeParam) ? modeParam : 'all',
    preset: isTimeFilterPreset(presetParam) ? presetParam : '15min',
    start: searchParams.get('time_start') ?? '',
    end: searchParams.get('time_end') ?? ''
  };
}

function isSameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function getRepresentativeScenarioMetadata(
  scenarios: ScenarioResult[]
): Pick<AgentSummary, 'provider' | 'model'> {
  const representativeScenario =
    scenarios.find((scenario) => scenario.provider && scenario.model) ??
    scenarios.find((scenario) => scenario.provider || scenario.model);
  return {
    provider: representativeScenario?.provider,
    model: representativeScenario?.model
  };
}

const Compare = () => {
  const { source } = useDataSource();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTimeFilter = getTimeFilterQueryState(searchParams);
  const mode: CompareMode = searchParams.get('mode') === 'within-run' ? 'within-run' : 'runs';
  const [results, setResults] = useState<EvalResult[]>([]);
  const [detailedRunsById, setDetailedRunsById] = useState<Record<string, EvalResult>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'id' | 'timestamp' | 'passRate' | 'scenarios'>('timestamp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [scenarioFilter, setScenarioFilter] = useState('all');
  const [openScenarioFilterPicker, setOpenScenarioFilterPicker] = useState(false);
  const [showDaySeparators, setShowDaySeparators] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(COMPARE_DAY_SEPARATOR_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [timeFilterMode, setTimeFilterMode] = useState<TimeFilterMode>(initialTimeFilter.mode);
  const [timeFilterPreset, setTimeFilterPreset] = useState<TimeFilterPreset>(
    initialTimeFilter.preset
  );
  const [timeFilterStart, setTimeFilterStart] = useState(initialTimeFilter.start);
  const [timeFilterEnd, setTimeFilterEnd] = useState(initialTimeFilter.end);
  const [openTimeFilterPicker, setOpenTimeFilterPicker] = useState(false);
  const pageLimit = 100;
  const pagination = useOffsetPagination(pageLimit);
  const { offset, hasMore, totalCount } = pagination;

  const initialWithinRunId = searchParams.get('runId') ?? '';
  const initialWithinRunAgents = (searchParams.get('agents') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const initialWithinRunScenario = searchParams.get('scenario') ?? 'all';

  const [withinRunId, setWithinRunId] = useState(initialWithinRunId);
  const [withinRunAgentIds, setWithinRunAgentIds] = useState<string[]>(initialWithinRunAgents);
  const [withinRunScenarioFilter, setWithinRunScenarioFilter] = useState(initialWithinRunScenario);
  const [openWithinRunScenarioPicker, setOpenWithinRunScenarioPicker] = useState(false);
  const refreshRequestIdRef = useRef(0);

  const apiTimeFilter = useMemo(() => {
    if (timeFilterMode === 'all') return {};
    if (timeFilterMode === 'last') {
      const preset =
        TIME_FILTER_PRESETS.find((item) => item.value === timeFilterPreset) ??
        TIME_FILTER_PRESETS[0]!;
      const now = new Date();
      return {
        since: new Date(now.getTime() - preset.durationMs).toISOString(),
        until: now.toISOString()
      };
    }
    const start = parseLocalDateTime(timeFilterStart)?.toISOString();
    const end = parseLocalDateTime(timeFilterEnd)?.toISOString();
    return {
      since: start,
      until: end
    };
  }, [timeFilterEnd, timeFilterMode, timeFilterPreset, timeFilterStart]);

  const loadResults = async () => {
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    setRefreshing(true);
    try {
      if (source.listRunSummariesPage) {
        const pageFilter: {
          limit: number;
          offset: number;
          scenario?: string;
          since?: string;
          until?: string;
        } = { limit: pageLimit, offset };
        if (scenarioFilter !== 'all') pageFilter.scenario = scenarioFilter;
        if (apiTimeFilter.since) pageFilter.since = apiTimeFilter.since;
        if (apiTimeFilter.until) pageFilter.until = apiTimeFilter.until;
        const page = await source.listRunSummariesPage(pageFilter);
        if (refreshRequestIdRef.current !== requestId) return;
        pagination.updateMeta(page);
        setResults(page.data.map(summaryToResult));
      } else {
        const next = await source.listResults();
        if (refreshRequestIdRef.current !== requestId) return;
        setResults(next);
      }
    } catch (error: unknown) {
      toast({
        title: 'Could not load results',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      if (refreshRequestIdRef.current === requestId) setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    refreshRequestIdRef.current += 1;
    setRefreshing(true);
    const loadPromise = source.listRunSummariesPage
      ? source
          .listRunSummariesPage({
            limit: pageLimit,
            offset,
            scenario: scenarioFilter === 'all' ? undefined : scenarioFilter,
            since: apiTimeFilter.since,
            until: apiTimeFilter.until
          })
          .then((page) => {
            if (active) {
              pagination.updateMeta(page);
            }
            return page.data.map(summaryToResult);
          })
      : source.listResults();
    loadPromise
      .then((next) => {
        if (active) setResults(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast({
          title: 'Could not load results',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive'
        });
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [offset, scenarioFilter, source, apiTimeFilter]);

  const toggleSort = (next: typeof sortBy) => {
    if (sortBy === next) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(next);
    setSortDir(next === 'timestamp' ? 'desc' : 'asc');
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const scenarioFilterOptions = useMemo(() => {
    const labels = new Set<string>();
    results.forEach((run) => {
      run.scenarios.forEach((scenario) => {
        const scenarioName = String(scenario.scenarioName ?? '').trim();
        const scenarioId = String(scenario.scenarioId ?? '').trim();
        const label = scenarioName || scenarioId;
        if (label) labels.add(label);
      });
    });
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [results]);

  const filteredResults = useMemo(() => {
    const scenarioFiltered =
      scenarioFilter === 'all'
        ? results
        : results.filter((run) =>
            run.scenarios.some((scenario) => {
              const scenarioName = String(scenario.scenarioName ?? '').trim();
              const scenarioId = String(scenario.scenarioId ?? '').trim();
              const label = scenarioName || scenarioId;
              return label === scenarioFilter;
            })
          );

    if (mode !== 'runs') return scenarioFiltered;
    if (timeFilterMode === 'all') return scenarioFiltered;

    const now = Date.now();
    if (timeFilterMode === 'last') {
      const preset =
        TIME_FILTER_PRESETS.find((item) => item.value === timeFilterPreset) ??
        TIME_FILTER_PRESETS[0]!;
      const minTimestamp = now - preset.durationMs;
      return scenarioFiltered.filter((run) => {
        const timestamp = new Date(run.timestamp).getTime();
        return timestamp >= minTimestamp && timestamp <= now;
      });
    }

    const start = parseLocalDateTime(timeFilterStart)?.getTime() ?? null;
    const end = parseLocalDateTime(timeFilterEnd)?.getTime() ?? null;
    const rangeStart = start !== null && end !== null ? Math.min(start, end) : start ?? null;
    const rangeEnd = start !== null && end !== null ? Math.max(start, end) : end ?? null;
    return scenarioFiltered.filter((run) => {
      const timestamp = new Date(run.timestamp).getTime();
      if (Number.isNaN(timestamp)) return false;
      if (rangeStart !== null && timestamp < rangeStart) return false;
      if (rangeEnd !== null && timestamp > rangeEnd) return false;
      return true;
    });
  }, [
    mode,
    results,
    scenarioFilter,
    timeFilterEnd,
    timeFilterMode,
    timeFilterPreset,
    timeFilterStart
  ]);

  const sortedResults = useMemo(() => {
    return [...filteredResults].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'id') cmp = a.id.localeCompare(b.id);
      if (sortBy === 'timestamp')
        cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sortBy === 'passRate') cmp = a.overallPassRate - b.overallPassRate;
      if (sortBy === 'scenarios') cmp = a.totalScenarios - b.totalScenarios;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredResults, sortBy, sortDir]);

  const selectedRuns = useMemo(
    () => sortedResults.filter((r) => selected.has(r.id)).map((r) => detailedRunsById[r.id] ?? r),
    [detailedRunsById, sortedResults, selected]
  );
  const sortedResultsWithDaySeparators = useMemo<CompareTableItem[]>(() => {
    if (!showDaySeparators) return sortedResults.map((run) => ({ type: 'run', run }));
    const items: CompareTableItem[] = [];
    let currentDayKey: string | null = null;
    for (const run of sortedResults) {
      const dayKey = getLocalDayKey(run.timestamp);
      if (dayKey !== currentDayKey) {
        items.push({
          type: 'day-separator',
          dayKey,
          dayLabel: formatLocalDayLabel(run.timestamp)
        });
        currentDayKey = dayKey;
      }
      items.push({ type: 'run', run });
    }
    return items;
  }, [showDaySeparators, sortedResults]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(COMPARE_DAY_SEPARATOR_STORAGE_KEY, showDaySeparators ? '1' : '0');
    } catch {
      // ignore localStorage failures (private mode/quota)
    }
  }, [showDaySeparators]);

  const sortIcon = (key: typeof sortBy) => {
    if (sortBy !== key) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDir === 'asc' ? (
      <ChevronUp className="h-3.5 w-3.5" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5" />
    );
  };

  const runScopesById = useMemo(() => {
    const map = new Map<string, RunScopeSummary>();
    for (const run of sortedResults) {
      map.set(run.id, buildRunScopeSummary(run));
    }
    return map;
  }, [sortedResults]);

  const defaultAgentsForRun = (run: EvalResult): string[] => {
    const agentIds = Array.from(
      new Set(run.scenarios.map((scenario) => scenario.agentId).filter(Boolean))
    );
    return agentIds.slice(0, Math.min(2, agentIds.length));
  };

  const startWithinRunFromRun = (run: EvalResult) => {
    const nextAgents = defaultAgentsForRun(run);
    setWithinRunId(run.id);
    setWithinRunAgentIds(nextAgents);
    setWithinRunScenarioFilter('all');
    const next = new URLSearchParams(searchParams);
    next.set('mode', 'within-run');
    next.set('runId', run.id);
    if (nextAgents.length > 0) next.set('agents', nextAgents.join(','));
    else next.delete('agents');
    next.delete('scenario');
    setSearchParams(next, { replace: true });
  };

  const allScenarioIds = useMemo(
    () => [...new Set(selectedRuns.flatMap((r) => r.scenarios.map((s) => s.scenarioId)))],
    [selectedRuns]
  );

  const scenarioLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of selectedRuns) {
      for (const scenario of run.scenarios) {
        const id = String(scenario.scenarioId ?? '').trim();
        if (!id) continue;
        const name = String(scenario.scenarioName ?? '').trim();
        map.set(id, name || id);
      }
    }
    return map;
  }, [selectedRuns]);

  const withinRun = useMemo(
    () => detailedRunsById[withinRunId] ?? results.find((result) => result.id === withinRunId),
    [detailedRunsById, results, withinRunId]
  );

  useEffect(() => {
    if (typeof source.getResult !== 'function') return;
    if (selected.size === 0 && !withinRunId) return;
    const ids = new Set<string>([...selected]);
    if (withinRunId) ids.add(withinRunId);
    for (const runId of ids) {
      if (detailedRunsById[runId]) continue;
      void source.getResult(runId).then((result) => {
        if (!result) return;
        setDetailedRunsById((prev) => (prev[runId] ? prev : { ...prev, [runId]: result }));
      });
    }
  }, [detailedRunsById, selected, source, withinRunId]);

  useEffect(() => {
    pagination.reset();
  }, [
    pagination.reset,
    scenarioFilter,
    timeFilterMode,
    timeFilterPreset,
    timeFilterStart,
    timeFilterEnd
  ]);

  const withinRunAgentOptions = useMemo(() => {
    if (!withinRun) return [];
    const map = new Map<string, string>();
    for (const scenario of withinRun.scenarios) {
      map.set(scenario.agentId, scenario.agentName || scenario.agentId);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [withinRun]);

  const withinRunScenarioOptions = useMemo(() => {
    if (!withinRun) return [];
    const labels = new Set<string>();
    for (const scenario of withinRun.scenarios) {
      const name = String(scenario.scenarioName ?? '').trim();
      const id = String(scenario.scenarioId ?? '').trim();
      const label = name || id;
      if (label) labels.add(label);
    }
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [withinRun]);

  const withinRunAgentIdsKey = useMemo(() => withinRunAgentIds.join(','), [withinRunAgentIds]);

  useEffect(() => {
    if (mode === 'within-run') {
      const nextRunId = searchParams.get('runId') ?? '';
      const nextAgents = (searchParams.get('agents') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const nextScenario = searchParams.get('scenario') ?? 'all';
      setWithinRunId((prev) => (prev === nextRunId ? prev : nextRunId));
      setWithinRunAgentIds((prev) => (isSameStringArray(prev, nextAgents) ? prev : nextAgents));
      setWithinRunScenarioFilter((prev) => (prev === nextScenario ? prev : nextScenario));
    }
  }, [mode, searchParams]);

  useEffect(() => {
    if (mode !== 'within-run') return;
    if (results.length === 0) return;

    let nextRunId = withinRunId;
    if (!nextRunId || !results.some((run) => run.id === nextRunId)) {
      nextRunId = results[0]!.id;
    }
    const nextRun = results.find((run) => run.id === nextRunId);
    const nextAgentOptions = (() => {
      if (!nextRun) return [];
      const map = new Map<string, string>();
      for (const scenario of nextRun.scenarios) {
        map.set(scenario.agentId, scenario.agentName || scenario.agentId);
      }
      return Array.from(map.keys());
    })();
    const validAgentSet = new Set(nextAgentOptions);
    let nextAgents = withinRunAgentIdsKey
      .split(',')
      .map((id) => id.trim())
      .filter((id): id is string => Boolean(id))
      .filter((id) => validAgentSet.has(id));
    if (nextAgents.length === 0 && nextAgentOptions.length > 0) {
      nextAgents = nextAgentOptions.slice(0, Math.min(2, nextAgentOptions.length));
    }
    const nextScenarioOptions = (() => {
      if (!nextRun) return new Set<string>();
      const labels = new Set<string>();
      for (const scenario of nextRun.scenarios) {
        const name = String(scenario.scenarioName ?? '').trim();
        const id = String(scenario.scenarioId ?? '').trim();
        const label = name || id;
        if (label) labels.add(label);
      }
      return new Set(labels);
    })();
    const nextScenarioFilter =
      withinRunScenarioFilter !== 'all' && !nextScenarioOptions.has(withinRunScenarioFilter)
        ? 'all'
        : withinRunScenarioFilter;

    if (nextRunId !== withinRunId) setWithinRunId(nextRunId);
    if (nextAgents.join(',') !== withinRunAgentIdsKey) setWithinRunAgentIds(nextAgents);
    if (nextScenarioFilter !== withinRunScenarioFilter)
      setWithinRunScenarioFilter(nextScenarioFilter);
  }, [mode, results, withinRunId, withinRunAgentIdsKey, withinRunScenarioFilter]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (mode === 'within-run') {
      next.set('mode', 'within-run');
      if (withinRunId) next.set('runId', withinRunId);
      else next.delete('runId');
      if (withinRunAgentIds.length > 0) next.set('agents', withinRunAgentIds.join(','));
      else next.delete('agents');
      if (withinRunScenarioFilter !== 'all') next.set('scenario', withinRunScenarioFilter);
      else next.delete('scenario');
      next.delete('time_filter');
      next.delete('time_preset');
      next.delete('time_start');
      next.delete('time_end');
    } else {
      next.delete('mode');
      next.delete('runId');
      next.delete('agents');
      next.delete('scenario');
      if (timeFilterMode === 'all') {
        next.delete('time_filter');
        next.delete('time_preset');
        next.delete('time_start');
        next.delete('time_end');
      } else if (timeFilterMode === 'last') {
        next.set('time_filter', 'last');
        next.set('time_preset', timeFilterPreset);
        next.delete('time_start');
        next.delete('time_end');
      } else {
        next.set('time_filter', 'custom');
        next.delete('time_preset');
        if (timeFilterStart.trim()) next.set('time_start', timeFilterStart.trim());
        else next.delete('time_start');
        if (timeFilterEnd.trim()) next.set('time_end', timeFilterEnd.trim());
        else next.delete('time_end');
      }
    }
    const currentString = searchParams.toString();
    const nextString = next.toString();
    if (currentString !== nextString) {
      setSearchParams(next, { replace: true });
    }
  }, [
    mode,
    timeFilterEnd,
    timeFilterMode,
    timeFilterPreset,
    timeFilterStart,
    withinRunId,
    withinRunAgentIds,
    withinRunScenarioFilter,
    searchParams,
    setSearchParams
  ]);

  const selectedTimeFilterLabel = useMemo(() => {
    if (timeFilterMode === 'all') return 'All time';
    if (timeFilterMode === 'last') {
      return (
        TIME_FILTER_PRESETS.find((item) => item.value === timeFilterPreset)?.label ?? 'Last range'
      );
    }
    const hasStart = Boolean(timeFilterStart.trim());
    const hasEnd = Boolean(timeFilterEnd.trim());
    if (!hasStart && !hasEnd) return 'Custom range';
    if (hasStart && hasEnd)
      return `${formatLocalDateTime(timeFilterStart)} - ${formatLocalDateTime(timeFilterEnd)}`;
    return hasStart
      ? `From ${formatLocalDateTime(timeFilterStart)}`
      : `Until ${formatLocalDateTime(timeFilterEnd)}`;
  }, [timeFilterEnd, timeFilterMode, timeFilterPreset, timeFilterStart]);

  const resetTimeFilter = () => {
    setTimeFilterMode('all');
    setTimeFilterPreset('15min');
    setTimeFilterStart('');
    setTimeFilterEnd('');
  };

  const withinRunScenarioRows = useMemo<WithinRunScenarioRow[]>(() => {
    if (!withinRun) return [];
    const scenarioMap = new Map<string, WithinRunScenarioRow>();
    for (const scenario of withinRun.scenarios) {
      const scenarioId = String(scenario.scenarioId ?? '').trim();
      const scenarioName = String(scenario.scenarioName ?? '').trim();
      const displayLabel = scenarioName || scenarioId;
      if (!scenarioId && !displayLabel) continue;
      const key = scenarioId || displayLabel;
      const existing = scenarioMap.get(key);
      if (existing) {
        existing.byAgent[scenario.agentId] = scenario;
        continue;
      }
      scenarioMap.set(key, {
        scenarioId: scenarioId || displayLabel,
        scenarioName,
        displayLabel: displayLabel || scenarioId,
        byAgent: { [scenario.agentId]: scenario }
      });
    }
    const rows = Array.from(scenarioMap.values()).sort((a, b) => {
      const left = (a.displayLabel || a.scenarioId).toLowerCase();
      const right = (b.displayLabel || b.scenarioId).toLowerCase();
      return left.localeCompare(right);
    });
    if (withinRunScenarioFilter === 'all') return rows;
    return rows.filter((row) => row.displayLabel === withinRunScenarioFilter);
  }, [withinRun, withinRunScenarioFilter]);

  const selectedWithinRunAgentOptions = useMemo(() => {
    const optionMap = new Map(withinRunAgentOptions.map((option) => [option.id, option]));
    return withinRunAgentIds
      .map((id) => optionMap.get(id))
      .filter((option): option is { id: string; name: string } => Boolean(option));
  }, [withinRunAgentIds, withinRunAgentOptions]);

  const withinRunComparePair = useMemo(() => {
    if (!withinRun || selectedWithinRunAgentOptions.length !== 2) return null;
    const [left, right] = selectedWithinRunAgentOptions;
    return {
      left,
      right,
      link: `/compare/results?left=${encodeURIComponent(withinRun.id)}&right=${encodeURIComponent(
        withinRun.id
      )}&leftConfig=${encodeURIComponent(withinRun.configId)}&rightConfig=${encodeURIComponent(
        withinRun.configId
      )}&leftAgent=${encodeURIComponent(left.id)}&rightAgent=${encodeURIComponent(right.id)}`
    };
  }, [withinRun, selectedWithinRunAgentOptions]);

  const withinRunAgentSummary = useMemo<AgentSummary[]>(() => {
    if (!withinRun || selectedWithinRunAgentOptions.length === 0) return [];
    return selectedWithinRunAgentOptions.map((agent) => {
      const relatedScenarios = withinRunScenarioRows
        .map((row) => row.byAgent[agent.id])
        .filter((value): value is ScenarioResult => Boolean(value));
      const runs = relatedScenarios.flatMap((scenario) => scenario.runs);
      const totalRuns = runs.length;
      const passCount = runs.filter((run) => run.passed).length;
      const totalToolCalls = runs.reduce((sum, run) => sum + run.toolCalls.length, 0);
      const totalDuration = runs.reduce((sum, run) => sum + run.duration, 0);
      const { provider, model } = getRepresentativeScenarioMetadata(relatedScenarios);
      return {
        agentId: agent.id,
        agentName: agent.name,
        provider,
        model,
        passRate: totalRuns === 0 ? 0 : passCount / totalRuns,
        totalRuns,
        avgToolCalls: totalRuns === 0 ? 0 : totalToolCalls / totalRuns,
        avgLatency: totalRuns === 0 ? 0 : totalDuration / totalRuns
      };
    });
  }, [withinRun, selectedWithinRunAgentOptions, withinRunScenarioRows]);

  const toggleWithinRunAgent = (agentId: string) => {
    setWithinRunAgentIds((prev) => {
      if (prev.includes(agentId)) {
        return prev.filter((id) => id !== agentId);
      }
      return [...prev, agentId];
    });
  };

  const renderRunDetail = (run: ScenarioRun) => (
    <div key={run.runIndex} className="min-w-0 rounded border bg-muted/20 px-2 py-1.5">
      <div className="text-xs">
        <span className="font-mono">#{run.runIndex + 1}</span>{' '}
        <span className={run.passed ? 'text-emerald-700' : 'text-destructive'}>
          {run.passed ? 'PASS' : 'FAIL'}
        </span>{' '}
        · tools: {run.toolCalls.length} · {run.duration}ms
      </div>
      {!run.passed && run.failureReasons.length > 0 && (
        <div className="mt-1 max-h-16 overflow-y-auto whitespace-pre-wrap break-all pr-1 text-[11px] text-muted-foreground">
          {run.failureReasons.join('; ')}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <GitCompare className="h-6 w-6" />
            Compare Runs
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === 'runs'
              ? 'Select 2–5 runs to compare'
              : 'Compare agents side-by-side within one run'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'within-run' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete('mode');
                next.delete('runId');
                next.delete('agents');
                next.delete('scenario');
                setSearchParams(next, { replace: true });
              }}
            >
              <ArrowLeftRight className="mr-1.5 h-4 w-4" />
              Back to Compare
            </Button>
          )}
          {mode === 'runs' && (
            <>
              <Popover open={openScenarioFilterPicker} onOpenChange={setOpenScenarioFilterPicker}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={openScenarioFilterPicker}
                    aria-controls="compare-scenario-command-list"
                    className={`w-[260px] justify-between font-normal ${
                      scenarioFilter !== 'all' ? 'border-primary/40' : ''
                    }`}
                  >
                    <span className="truncate text-left">
                      {scenarioFilter === 'all' ? 'All scenarios' : scenarioFilter}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search scenarios..." />
                    <CommandList id="compare-scenario-command-list">
                      <CommandEmpty>No scenarios found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="all scenarios"
                          onSelect={() => {
                            setScenarioFilter('all');
                            setOpenScenarioFilterPicker(false);
                          }}
                        >
                          All scenarios
                        </CommandItem>
                        {scenarioFilterOptions.map((label) => (
                          <CommandItem
                            key={label}
                            value={label}
                            onSelect={() => {
                              setScenarioFilter(label);
                              setOpenScenarioFilterPicker(false);
                            }}
                          >
                            {label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Popover open={openTimeFilterPicker} onOpenChange={setOpenTimeFilterPicker}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={openTimeFilterPicker}
                    aria-controls="compare-time-command-list"
                    className={`w-[320px] justify-between font-normal ${
                      timeFilterMode !== 'all' ? 'border-primary/40' : ''
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate text-left">
                      <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{selectedTimeFilterLabel}</span>
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0" align="start">
                  <div className="border-b px-3 py-2">
                    <p className="text-sm font-medium">Date and time filter</p>
                    <p className="text-xs text-muted-foreground">Filter runs by timestamp.</p>
                  </div>
                  <div id="compare-time-command-list" className="grid gap-1 p-2">
                    <Button
                      type="button"
                      variant={timeFilterMode === 'all' ? 'secondary' : 'ghost'}
                      className="justify-start"
                      onClick={() => {
                        resetTimeFilter();
                        setOpenTimeFilterPicker(false);
                      }}
                    >
                      All time
                    </Button>
                    {TIME_FILTER_PRESETS.map((preset) => (
                      <Button
                        key={preset.value}
                        type="button"
                        variant={
                          timeFilterMode === 'last' && timeFilterPreset === preset.value
                            ? 'secondary'
                            : 'ghost'
                        }
                        className="justify-start"
                        onClick={() => {
                          setTimeFilterMode('last');
                          setTimeFilterPreset(preset.value);
                          setOpenTimeFilterPicker(false);
                        }}
                      >
                        {preset.label}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant={timeFilterMode === 'custom' ? 'secondary' : 'ghost'}
                      className="justify-start"
                      onClick={() => setTimeFilterMode('custom')}
                    >
                      Custom date time range
                    </Button>
                  </div>
                  {timeFilterMode === 'custom' && (
                    <div className="space-y-3 border-t p-3">
                      <div className="space-y-2">
                        <Label htmlFor="compare-time-filter-start">Start</Label>
                        <Input
                          id="compare-time-filter-start"
                          type="datetime-local"
                          value={timeFilterStart}
                          onChange={(event) => setTimeFilterStart(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="compare-time-filter-end">End</Label>
                        <Input
                          id="compare-time-filter-end"
                          type="datetime-local"
                          value={timeFilterEnd}
                          onChange={(event) => setTimeFilterEnd(event.target.value)}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="px-2"
                          onClick={resetTimeFilter}
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" />
                          Clear
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setOpenTimeFilterPicker(false)}
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </>
          )}
          <div className="inline-flex items-center gap-2 rounded-md border px-3 py-2">
            <Label htmlFor="compare-day-separators-switch" className="text-sm font-medium">
              Group by day
            </Label>
            <Switch
              id="compare-day-separators-switch"
              checked={showDaySeparators}
              onCheckedChange={setShowDaySeparators}
              aria-label="Group by day"
            />
          </div>
          <Button variant="outline" onClick={() => void loadResults()} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button variant="outline" onClick={pagination.prev} disabled={refreshing || offset === 0}>
            Prev
          </Button>
          <Button variant="outline" onClick={pagination.next} disabled={refreshing || !hasMore}>
            Next
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{pagination.rangeLabel(results.length)}</p>

      {mode === 'within-run' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Within One Run Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Run</p>
                <Select value={withinRunId} onValueChange={setWithinRunId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select run" />
                  </SelectTrigger>
                  <SelectContent>
                    {results.map((run) => (
                      <SelectItem key={run.id} value={run.id}>
                        {run.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Scenario filter</p>
                <Popover
                  open={openWithinRunScenarioPicker}
                  onOpenChange={setOpenWithinRunScenarioPicker}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={openWithinRunScenarioPicker}
                      aria-controls="compare-within-run-scenario-command-list"
                      className="w-full justify-between font-normal"
                    >
                      <span className="truncate text-left">
                        {withinRunScenarioFilter === 'all'
                          ? 'All scenarios'
                          : withinRunScenarioFilter}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                  >
                    <Command>
                      <CommandInput placeholder="Search scenarios..." />
                      <CommandList id="compare-within-run-scenario-command-list">
                        <CommandEmpty>No scenarios found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="all scenarios"
                            onSelect={() => {
                              setWithinRunScenarioFilter('all');
                              setOpenWithinRunScenarioPicker(false);
                            }}
                          >
                            All scenarios
                          </CommandItem>
                          {withinRunScenarioOptions.map((label) => (
                            <CommandItem
                              key={label}
                              value={label}
                              onSelect={() => {
                                setWithinRunScenarioFilter(label);
                                setOpenWithinRunScenarioPicker(false);
                              }}
                            >
                              {label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Agents (select 2+)</p>
              <div className="flex flex-wrap gap-3 rounded-md border p-3">
                {withinRunAgentOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No agents available for selected run.
                  </p>
                )}
                {withinRunAgentOptions.map((agent) => (
                  <label key={agent.id} className="inline-flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={withinRunAgentIds.includes(agent.id)}
                      onCheckedChange={() => toggleWithinRunAgent(agent.id)}
                    />
                    <span>{agent.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === 'runs' && (
        <Card>
          <CardContent className="p-0">
            <Table containerClassName="max-h-[36rem] overflow-auto">
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('id')}
                    >
                      Run ID
                      {sortIcon('id')}
                    </button>
                  </TableHead>
                  <TableHead>Evaluated</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('timestamp')}
                    >
                      Timestamp
                      {sortIcon('timestamp')}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      className="inline-flex w-full items-center justify-end gap-1 hover:text-foreground"
                      onClick={() => toggleSort('passRate')}
                    >
                      Pass Rate
                      {sortIcon('passRate')}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('scenarios')}
                    >
                      Scenarios
                      {sortIcon('scenarios')}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">Agents</TableHead>
                  <TableHead className="w-[140px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedResultsWithDaySeparators.map((item, index) =>
                  item.type === 'day-separator' ? (
                    <TableRow
                      key={`day-${item.dayKey}-${index}`}
                      className="bg-muted/30 hover:bg-muted/30"
                    >
                      <TableCell colSpan={COMPARE_RUNS_TABLE_COLUMN_COUNT} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-border/70" />
                          <span className="shrink-0 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {item.dayLabel}
                          </span>
                          <div className="h-px flex-1 bg-border/70" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={item.run.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(item.run.id)}
                          onCheckedChange={() => toggle(item.run.id)}
                          disabled={!selected.has(item.run.id) && selected.size >= 5}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.run.id}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {(() => {
                          const scope = runScopesById.get(item.run.id) ?? {
                            scenarioCount: 0,
                            agentCount: 0,
                            scopePreview: 'n/a',
                            modelSummary: ''
                          };
                          return (
                            <div className="space-y-0.5">
                              <div>
                                Evaluated: {scope.scenarioCount} scenario
                                {scope.scenarioCount === 1 ? '' : 's'} · {scope.agentCount} agent
                                {scope.agentCount === 1 ? '' : 's'}
                                {scope.modelSummary ? ` · ${scope.modelSummary}` : ''}
                              </div>
                              <div className="font-mono text-xs text-foreground/80">
                                {scope.scopePreview}
                              </div>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(item.run.timestamp).toLocaleString()}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground/90">
                            Duration: {formatDurationMs(getRunTotalDurationMs(item.run))}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <PassRateBadge rate={item.run.overallPassRate} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {item.run.totalScenarios}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {runScopesById.get(item.run.id)?.agentCount ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        {(runScopesById.get(item.run.id)?.agentCount ?? 0) > 1 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => startWithinRunFromRun(item.run)}
                          >
                            Compare agents
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {mode === 'runs' && selectedRuns.length < 2 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium">No runs selected</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Select 2–5 runs from the table above to start a comparison.
            </p>
          </CardContent>
        </Card>
      )}

      {mode === 'runs' && selectedRuns.length >= 2 && (
        <>
          {selectedRuns.length === 2 && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Need a deeper comparison?</p>
                    <p className="text-xs text-muted-foreground">
                      Open the two selected runs in a dedicated side-by-side full result compare
                      view.
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link
                      to={`/compare/results?left=${encodeURIComponent(
                        selectedRuns[0].id
                      )}&right=${encodeURIComponent(
                        selectedRuns[1].id
                      )}&leftConfig=${encodeURIComponent(
                        selectedRuns[0].configId
                      )}&rightConfig=${encodeURIComponent(selectedRuns[1].configId)}`}
                    >
                      Compare full results
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Summary Comparison</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[24rem] overflow-auto p-0">
              <Table className="table-fixed">
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
                  <TableRow>
                    <TableHead className="w-[220px]">Metric</TableHead>
                    {selectedRuns.map((r, i) => (
                      <TableHead
                        key={r.id}
                        style={{ color: colors[i] }}
                        className="font-mono text-xs"
                      >
                        <div>{r.id}</div>
                        {r.configPath?.trim() ? (
                          <div className="mt-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                            {r.configPath.trim()}
                          </div>
                        ) : null}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Pass Rate</TableCell>
                    {selectedRuns.map((r) => (
                      <TableCell key={r.id}>
                        <PassRateBadge rate={r.overallPassRate} />
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Total Runs</TableCell>
                    {selectedRuns.map((r) => (
                      <TableCell key={r.id} className="font-mono">
                        {r.totalRuns}
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Tool Calls</TableCell>
                    {selectedRuns.map((r) => (
                      <TableCell key={r.id} className="font-mono">
                        {r.avgToolCalls.toFixed(1)}
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Avg Latency</TableCell>
                    {selectedRuns.map((r) => (
                      <TableCell key={r.id} className="font-mono">
                        {r.avgLatency}ms
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Duration</TableCell>
                    {selectedRuns.map((r) => (
                      <TableCell key={r.id} className="font-mono">
                        {formatDurationMs(getRunTotalDurationMs(r))}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Scenario Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[26rem] overflow-auto p-0">
              <Table className="table-fixed">
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
                  <TableRow>
                    <TableHead className="w-[220px]">Scenario</TableHead>
                    {selectedRuns.map((r, i) => (
                      <TableHead
                        key={r.id}
                        style={{ color: colors[i] }}
                        className="font-mono text-xs"
                      >
                        <div>{r.id}</div>
                        {r.configPath?.trim() ? (
                          <div className="mt-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                            {r.configPath.trim()}
                          </div>
                        ) : null}
                        <div className="mt-0.5 text-[10px] font-normal text-muted-foreground">
                          MCP: {formatMcpServersWithVersions(r.mcpServerVersions)}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allScenarioIds.map((sid) => (
                    <TableRow key={sid}>
                      <TableCell className="font-medium text-sm">
                        {scenarioLabelById.get(sid) ?? sid}
                      </TableCell>
                      {selectedRuns.map((r) => {
                        const sc = r.scenarios.find((s) => s.scenarioId === sid);
                        return (
                          <TableCell key={r.id}>
                            {sc ? (
                              <PassRateBadge rate={sc.passRate} />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {mode === 'runs' && selectedRuns.length >= 2 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pass Rate Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={selectedRuns.map((r, i) => ({
                  idx: i + 1,
                  runId: r.id,
                  passRate: Number((r.overallPassRate * 100).toFixed(1))
                }))}
              >
                <XAxis dataKey="idx" tickFormatter={(v) => String(v)} />
                <YAxis unit="%" domain={[0, 100]} />
                <Tooltip
                  formatter={(value) => [`${value}%`, 'Pass Rate']}
                  labelFormatter={(label) => `Run ${label}`}
                />
                <Legend />
                <Line type="monotone" dataKey="passRate" stroke={colors[0]} strokeWidth={2.5} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {mode === 'within-run' && withinRun && selectedWithinRunAgentOptions.length < 2 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Select at least 2 agents to compare side-by-side within this run.
          </CardContent>
        </Card>
      )}

      {mode === 'within-run' && withinRun && selectedWithinRunAgentOptions.length >= 2 && (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Need full result details?</p>
                  <p className="text-xs text-muted-foreground">
                    {withinRunComparePair
                      ? 'Open a side-by-side full result view filtered by the selected agents.'
                      : 'Open the complete run result page for all details and trace navigation.'}
                  </p>
                </div>
                <Button asChild size="sm">
                  {withinRunComparePair ? (
                    <Link to={withinRunComparePair.link}>Compare full results</Link>
                  ) : (
                    <Link
                      to={`/results/${encodeURIComponent(withinRun.id)}${
                        withinRun.configId
                          ? `?configId=${encodeURIComponent(withinRun.configId)}`
                          : ''
                      }`}
                    >
                      Open full result
                    </Link>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Agent Summary</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[24rem] overflow-auto p-0">
              <Table>
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    {withinRunAgentSummary.map((summary) => (
                      <TableHead key={summary.agentId}>
                        <div className="font-medium text-sm">{summary.agentName}</div>
                        {(summary.provider || summary.model) && (
                          <div className="font-mono text-xs font-normal text-muted-foreground">
                            {[
                              summary.provider ? formatProvider(summary.provider) : null,
                              summary.model
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Pass Rate</TableCell>
                    {withinRunAgentSummary.map((summary) => (
                      <TableCell key={summary.agentId}>
                        <PassRateBadge rate={summary.passRate} />
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Total Runs</TableCell>
                    {withinRunAgentSummary.map((summary) => (
                      <TableCell key={summary.agentId} className="font-mono">
                        {summary.totalRuns}
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Avg Tool Calls</TableCell>
                    {withinRunAgentSummary.map((summary) => (
                      <TableCell key={summary.agentId} className="font-mono">
                        {summary.avgToolCalls.toFixed(1)}
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Avg Latency</TableCell>
                    {withinRunAgentSummary.map((summary) => (
                      <TableCell key={summary.agentId} className="font-mono">
                        {Math.round(summary.avgLatency)}ms
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Scenario × Agent Matrix</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[34rem] overflow-auto p-0">
              <Table className="table-fixed">
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
                  <TableRow>
                    <TableHead className="w-[260px]">Scenario</TableHead>
                    {selectedWithinRunAgentOptions.map((agent) => {
                      const summary = withinRunAgentSummary.find((s) => s.agentId === agent.id);
                      return (
                        <TableHead key={agent.id}>
                          <div className="font-medium text-sm">{agent.name}</div>
                          {(summary?.provider || summary?.model) && (
                            <div className="font-mono text-xs font-normal text-muted-foreground">
                              {[
                                summary.provider ? formatProvider(summary.provider) : null,
                                summary.model
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {withinRunScenarioRows.map((row) => (
                    <TableRow key={row.scenarioId}>
                      <TableCell className="font-medium text-sm">{row.displayLabel}</TableCell>
                      {selectedWithinRunAgentOptions.map((agent) => {
                        const scenario = row.byAgent[agent.id];
                        if (!scenario) {
                          return (
                            <TableCell key={agent.id}>
                              <span className="text-xs text-muted-foreground">—</span>
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={agent.id} className="min-w-0 align-top">
                            <div className="space-y-2">
                              <div className="text-xs text-muted-foreground">
                                <PassRateBadge rate={scenario.passRate} />{' '}
                                <span className="ml-2">runs: {scenario.runs.length}</span> · calls:{' '}
                                {scenario.avgToolCalls.toFixed(1)} · latency:{' '}
                                {Math.round(scenario.avgDuration)}ms
                              </div>
                              {scenario.runs.length > 0 ? (
                                <div className="space-y-1.5">
                                  {scenario.runs.map((run) => renderRunDetail(run))}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">
                                  No runs captured.
                                </div>
                              )}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default Compare;
