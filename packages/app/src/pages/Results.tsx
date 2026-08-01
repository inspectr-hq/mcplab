import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Clock,
  MoreHorizontal,
  Eye,
  LayoutDashboard,
  Download,
  Play,
  Bot,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  RectangleEllipsis,
  User,
  Wrench,
  BarChart3,
  Sparkles,
  CalendarRange,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { PassRateBadge } from '@/components/PassRateBadge';
import { MarkdownContent } from '@/components/MarkdownContent';
import { ResultAssistantPanel } from '@/components/results/ResultAssistantPanel';
import ResultsDashboard from '@/components/results/ResultsDashboard';
import { RunFailureSignalBadge } from '@/components/results/RunFailureSignalBadge';
import { useDataSource } from '@/contexts/DataSourceContext';
import { useResultAssistant } from '@/hooks/use-result-assistant';
import { toast } from '@/hooks/use-toast';
import { formatAssistantToolName } from '@/lib/assistant-tool-name';
import { buildRunScopeSummary, type RunScopeSummary } from '@/lib/run-scope-summary';
import type { EvalResult } from '@/types/eval';
import { summaryToResult } from '@/lib/run-summary-to-result';
import { rerunWithSameSettings } from '@/lib/rerun-run';
import { useOffsetPagination } from '@/hooks/use-offset-pagination';
import { useRunQueueStatus } from '@/hooks/use-run-queue-status';
import { formatDurationMs, getRunToolTimeMs, getRunTotalDurationMs } from '@/lib/run-duration';

type TimeFilterPreset = '15min' | '30min' | '1h' | '24h' | '7d' | '14d' | '30d';
type TimeFilterMode = 'all' | 'last' | 'custom';
type TimeFilterQueryState = {
  mode: TimeFilterMode;
  preset: TimeFilterPreset;
  start: string;
  end: string;
};
type ResultTableItem =
  | { type: 'day-separator'; dayKey: string; dayLabel: string }
  | { type: 'run'; run: EvalResult };

const RESULTS_TABLE_COLUMN_COUNT = 8;
const RESULTS_TIME_FILTER_STORAGE_KEY = 'mcplab:results:time-filter';
const RESULTS_DASHBOARD_VISIBILITY_KEY = 'mcplab:results:dashboard-visible';

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

function hasExplicitTimeFilterQuery(searchParams: URLSearchParams): boolean {
  return (
    searchParams.has('time_filter') ||
    searchParams.has('time_preset') ||
    searchParams.has('time_start') ||
    searchParams.has('time_end')
  );
}

function readStoredTimeFilter(): TimeFilterQueryState | null {
  try {
    const raw = localStorage.getItem(RESULTS_TIME_FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TimeFilterQueryState>;
    const mode = isTimeFilterMode(typeof parsed.mode === 'string' ? parsed.mode : null)
      ? parsed.mode
      : 'all';
    const preset = isTimeFilterPreset(typeof parsed.preset === 'string' ? parsed.preset : null)
      ? parsed.preset
      : '15min';
    return {
      mode,
      preset,
      start: typeof parsed.start === 'string' ? parsed.start : '',
      end: typeof parsed.end === 'string' ? parsed.end : ''
    };
  } catch {
    return null;
  }
}

function readStoredDashboardVisibility(): boolean {
  try {
    const stored = localStorage.getItem(RESULTS_DASHBOARD_VISIBILITY_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

const RESULT_ASSISTANT_SNIPPETS = [
  {
    label: 'Summarize Run Trends',
    description: 'Highlight the main changes across the selected runs.',
    prompt:
      'Summarize the main trends across these runs. Call out pass-rate changes, latency, and tool usage shifts.'
  },
  {
    label: 'Explain Failures',
    description: 'Identify the most important failures and likely root causes.',
    prompt:
      'Identify the most important failures across these runs and explain likely root causes from the traces.'
  },
  {
    label: 'Compare Agents',
    description: 'Compare agent behavior, tool use, and answer quality across runs.',
    prompt:
      'Compare agent behavior across these runs. Highlight differences in tool use, answer quality, and consistency.'
  },
  {
    label: 'Spot Anomalies',
    description: 'Find outliers in latency, tool calls, or pass rate.',
    prompt:
      'Find unusual runs or outliers in latency, tool calls, or pass rate, and explain why they stand out.'
  }
] as const;
const PAGE_LIMIT = 100;

const Results = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { source } = useDataSource();
  const [initialTimeFilter] = useState<TimeFilterQueryState>(() =>
    hasExplicitTimeFilterQuery(searchParams)
      ? getTimeFilterQueryState(searchParams)
      : readStoredTimeFilter() ?? getTimeFilterQueryState(searchParams)
  );
  const [results, setResults] = useState<EvalResult[]>([]);
  const [dashboardRuns, setDashboardRuns] = useState<EvalResult[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardVisible, setDashboardVisible] = useState(readStoredDashboardVisibility);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDeleteRunId, setPendingDeleteRunId] = useState<string | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [sortBy, setSortBy] = useState<
    'id' | 'timestamp' | 'passRate' | 'scenarios' | 'avgToolCalls' | 'toolTokens'
  >('timestamp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [scenarioFilter, setScenarioFilter] = useState('all');
  const [openScenarioFilterPicker, setOpenScenarioFilterPicker] = useState(false);
  const [timeFilterMode, setTimeFilterMode] = useState<TimeFilterMode>(initialTimeFilter.mode);
  const [timeFilterPreset, setTimeFilterPreset] = useState<TimeFilterPreset>(
    initialTimeFilter.preset
  );
  const [timeFilterStart, setTimeFilterStart] = useState(initialTimeFilter.start);
  const [timeFilterEnd, setTimeFilterEnd] = useState(initialTimeFilter.end);
  const [openTimeFilterPicker, setOpenTimeFilterPicker] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const { completionVersion } = useRunQueueStatus();
  const pagination = useOffsetPagination(PAGE_LIMIT);
  const { offset, totalCount, hasMore } = pagination;
  const [rerunningRunId, setRerunningRunId] = useState<string | null>(null);
  const apiScenarioFilter = scenarioFilter === 'all' ? undefined : scenarioFilter;
  const apiTimeFilter = useMemo(() => {
    if (timeFilterMode === 'all') return {};
    if (timeFilterMode === 'last') {
      const preset =
        TIME_FILTER_PRESETS.find((item) => item.value === timeFilterPreset) ??
        TIME_FILTER_PRESETS[0]!;
      const now = new Date();
      const since = new Date(now.getTime() - preset.durationMs);
      return { since: since.toISOString(), until: now.toISOString() };
    }
    const start = parseLocalDateTime(timeFilterStart);
    const end = parseLocalDateTime(timeFilterEnd);
    if (start && end) {
      return start.getTime() <= end.getTime()
        ? { since: start.toISOString(), until: end.toISOString() }
        : { since: end.toISOString(), until: start.toISOString() };
    }
    if (start) return { since: start.toISOString() };
    if (end) return { until: end.toISOString() };
    return {};
  }, [timeFilterEnd, timeFilterMode, timeFilterPreset, timeFilterStart]);
  const toggleSort = (next: typeof sortBy) => {
    if (sortBy === next) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(next);
    setSortDir(next === 'timestamp' ? 'desc' : 'asc');
  };

  const loadResults = async () => {
    setRefreshing(true);
    try {
      if (source.listRunSummariesPage) {
        const page = await source.listRunSummariesPage({
          ...apiTimeFilter,
          scenario: apiScenarioFilter,
          limit: PAGE_LIMIT,
          offset
        });
        pagination.updateMeta(page);
        setResults(page.data.map(summaryToResult));
      } else if (source.listRunSummaries) {
        const summaries = await source.listRunSummaries({
          ...apiTimeFilter,
          scenario: apiScenarioFilter,
          limit: PAGE_LIMIT,
          offset
        });
        pagination.setTotalCount(summaries.length);
        pagination.setHasMore(false);
        setResults(summaries.map(summaryToResult));
      } else {
        pagination.setTotalCount(0);
        pagination.setHasMore(false);
        setResults(await source.listResults());
      }
    } catch (error: unknown) {
      toast({
        title: 'Could not load results',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    setRefreshing(true);
    const loadPromise = source.listRunSummariesPage
      ? source
          .listRunSummariesPage({
            ...apiTimeFilter,
            scenario: apiScenarioFilter,
            limit: PAGE_LIMIT,
            offset
          })
          .then((page) => {
            if (active) {
              pagination.updateMeta(page);
            }
            return page.data.map(summaryToResult);
          })
      : source.listRunSummaries
      ? source
          .listRunSummaries({
            ...apiTimeFilter,
            scenario: apiScenarioFilter,
            limit: PAGE_LIMIT,
            offset
          })
          .then((summaries) => {
            if (active) {
              pagination.setTotalCount(summaries.length);
              pagination.setHasMore(false);
            }
            return summaries.map(summaryToResult);
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
  }, [apiScenarioFilter, apiTimeFilter, completionVersion, offset, source]);

  useEffect(() => {
    try {
      localStorage.setItem(RESULTS_DASHBOARD_VISIBILITY_KEY, String(dashboardVisible));
    } catch {
      // ignore persistence failures
    }
  }, [dashboardVisible]);

  useEffect(() => {
    if (!dashboardVisible || !source.listRunSummaries) return;
    let active = true;
    setDashboardLoading(true);
    source
      .listRunSummaries({
        ...apiTimeFilter,
        scenario: apiScenarioFilter
      })
      .then((summaries) => {
        if (active) setDashboardRuns(summaries.map(summaryToResult));
      })
      .catch(() => {
        if (active) setDashboardRuns([]);
      })
      .finally(() => {
        if (active) setDashboardLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiScenarioFilter, apiTimeFilter, completionVersion, dashboardVisible, source]);

  useEffect(() => {
    if (dashboardVisible && source.listRunSummaries) return;
    if (!dashboardVisible) {
      setDashboardLoading(false);
      return;
    }
    setDashboardRuns(results);
    setDashboardLoading(false);
  }, [dashboardVisible, results, source]);

  const {
    assistantMessages,
    assistantPendingToolCalls,
    assistantInput,
    assistantLoading,
    assistantTurnCancelable,
    cancelAssistantTurn,
    assistantChatEndRef,
    assistantInputRef,
    setAssistantInput,
    askAssistant,
    approveResultAssistantToolCall,
    denyResultAssistantToolCall,
    applyResultAssistantSnippet,
    ensureIntroMessage
  } = useResultAssistant({
    source,
    open: assistantOpen,
    scope: 'all_runs'
  });

  const scenarioFilterOptions = useMemo(() => {
    const options = new Map<string, string>();
    results.forEach((run) => {
      run.scenarios.forEach((scenario) => {
        const scenarioName = String(scenario.scenarioName ?? '').trim();
        const scenarioId = String(scenario.scenarioId ?? '').trim();
        if (scenarioId) {
          options.set(scenarioId, scenarioName || scenarioId);
          return;
        }
        if (scenarioName) {
          options.set(scenarioName, scenarioName);
        }
      });
    });
    return Array.from(options.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [results]);

  useEffect(() => {
    const requestedScenario = (searchParams.get('scenario') ?? '').trim();
    if (!requestedScenario) return;
    if (
      scenarioFilterOptions.some(
        (option) => option.value === requestedScenario || option.label === requestedScenario
      )
    ) {
      setScenarioFilter(requestedScenario);
      return;
    }
    if (results.length > 0) {
      setScenarioFilter('all');
    }
  }, [searchParams, scenarioFilterOptions, results.length]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
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

    const nextString = next.toString();
    if (nextString !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [
    searchParams,
    setSearchParams,
    timeFilterEnd,
    timeFilterMode,
    timeFilterPreset,
    timeFilterStart
  ]);

  useEffect(() => {
    try {
      if (timeFilterMode === 'all') {
        localStorage.removeItem(RESULTS_TIME_FILTER_STORAGE_KEY);
        return;
      }
      const next: TimeFilterQueryState = {
        mode: timeFilterMode,
        preset: timeFilterPreset,
        start: timeFilterStart,
        end: timeFilterEnd
      };
      localStorage.setItem(RESULTS_TIME_FILTER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore persistence failures
    }
  }, [timeFilterEnd, timeFilterMode, timeFilterPreset, timeFilterStart]);

  const filteredResults = useMemo(() => {
    if (source.listRunSummariesPage) return results;
    const scenarioFiltered =
      scenarioFilter === 'all'
        ? results
        : results.filter((run) =>
            run.scenarios.some((scenario) => {
              const scenarioName = String(scenario.scenarioName ?? '').trim();
              const scenarioId = String(scenario.scenarioId ?? '').trim();
              return scenarioName === scenarioFilter || scenarioId === scenarioFilter;
            })
          );

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
    results,
    scenarioFilter,
    source.listRunSummariesPage,
    timeFilterEnd,
    timeFilterMode,
    timeFilterPreset,
    timeFilterStart
  ]);

  useEffect(() => {
    pagination.reset();
  }, [apiScenarioFilter, apiTimeFilter, pagination.reset]);

  const selectedScenarioFilterLabel = useMemo(() => {
    if (scenarioFilter === 'all') return 'All scenarios';
    const option = scenarioFilterOptions.find(
      (item) => item.value === scenarioFilter || item.label === scenarioFilter
    );
    return option?.label ?? scenarioFilter;
  }, [scenarioFilter, scenarioFilterOptions]);

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

  const sorted = useMemo(() => {
    const compareNullableNumbers = (left: number | null, right: number | null) => {
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return sortDir === 'asc' ? left - right : right - left;
    };
    const next = [...filteredResults].sort((a, b) => {
      if (sortBy === 'toolTokens') {
        return compareNullableNumbers(
          a.toolTokenUsage?.totalTokens ?? null,
          b.toolTokenUsage?.totalTokens ?? null
        );
      }
      let cmp = 0;
      if (sortBy === 'id') cmp = a.id.localeCompare(b.id);
      if (sortBy === 'timestamp')
        cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sortBy === 'passRate') cmp = a.overallPassRate - b.overallPassRate;
      if (sortBy === 'scenarios') cmp = a.totalScenarios - b.totalScenarios;
      if (sortBy === 'avgToolCalls') cmp = a.avgToolCalls - b.avgToolCalls;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return next;
  }, [filteredResults, sortBy, sortDir]);

  const sortedWithDaySeparators = useMemo(() => {
    const items: ResultTableItem[] = [];
    let currentDayKey: string | null = null;

    for (const run of sorted) {
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
  }, [sorted]);

  const sortIcon = (key: typeof sortBy) => {
    if (sortBy !== key) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDir === 'asc' ? (
      <ChevronUp className="h-3.5 w-3.5" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5" />
    );
  };

  const formatToolTokenTotal = (result: EvalResult) => {
    const total = result.toolTokenUsage?.totalTokens;
    return typeof total === 'number' ? total.toLocaleString() : 'n/a';
  };

  const resetTimeFilter = () => {
    setTimeFilterMode('all');
    setTimeFilterPreset('15min');
    setTimeFilterStart('');
    setTimeFilterEnd('');
  };

  const runScopesById = useMemo(() => {
    const map = new Map<string, RunScopeSummary>();
    for (const run of sorted) {
      if (run.scenarios.length > 0) {
        map.set(run.id, buildRunScopeSummary(run));
        continue;
      }
      const evalName = run.configName?.trim() || '';
      const configPath = run.configPath?.trim() || '';
      const evalLabel =
        evalName && configPath ? `${evalName} · ${configPath}` : evalName || configPath;
      map.set(run.id, {
        scenarioCount: run.totalScenarios,
        agentCount: 0,
        scopePreview: evalLabel || 'n/a',
        modelSummary: ''
      });
    }
    return map;
  }, [sorted]);

  const openGlobalAssistant = () => {
    setAssistantOpen(true);
    ensureIntroMessage(
      'Ask me to compare runs, explain regressions over time, or summarize historical drift patterns.'
    );
  };

  const handleDeleteRun = async (runId: string) => {
    setDeletingRun(true);
    try {
      await source.deleteResult(runId);
      setResults((prev) => prev.filter((r) => r.id !== runId));
      toast({ title: 'Run deleted', description: runId });
      setPendingDeleteRunId(null);
    } catch (error: unknown) {
      toast({
        title: 'Could not delete run',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setDeletingRun(false);
    }
  };

  const handleRerun = async (run: EvalResult) => {
    const configPath = run.configPath?.trim();
    if (!configPath) {
      toast({
        title: 'Cannot rerun',
        description: 'This run has no config path in metadata.',
        variant: 'destructive'
      });
      return;
    }
    setRerunningRunId(run.id);
    try {
      await rerunWithSameSettings(source, run);
      toast({
        title: 'Rerun queued',
        description: `${run.id} queued with previous run settings.`
      });
    } catch (error: unknown) {
      toast({
        title: 'Could not rerun',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setRerunningRunId((current) => (current === run.id ? null : current));
    }
  };

  return (
    <div className="flex flex-col">
      <AlertDialog
        open={pendingDeleteRunId !== null}
        onOpenChange={(open) => {
          if (!open && !deletingRun) setPendingDeleteRunId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the run artifacts from disk for{' '}
              <span className="font-mono">{pendingDeleteRunId ?? ''}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingRun}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingRun || !pendingDeleteRunId}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingDeleteRunId) return;
                void handleDeleteRun(pendingDeleteRunId);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingRun ? 'Deleting...' : 'Delete run'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <BarChart3 className="h-6 w-6" />
            Results
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse evaluation runs and open detailed results
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={openScenarioFilterPicker} onOpenChange={setOpenScenarioFilterPicker}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={openScenarioFilterPicker}
                aria-controls="results-scenario-command-list"
                className={`w-[260px] justify-between font-normal ${
                  scenarioFilter !== 'all' ? 'border-primary/40' : ''
                }`}
              >
                <span className="truncate text-left">{selectedScenarioFilterLabel}</span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[260px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search scenarios..." />
                <CommandList id="results-scenario-command-list">
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
                    {scenarioFilterOptions.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={`${option.label} ${option.value}`}
                        onSelect={() => {
                          setScenarioFilter(option.value);
                          setOpenScenarioFilterPicker(false);
                        }}
                      >
                        {option.label}
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
                aria-controls="results-time-command-list"
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
              <div id="results-time-command-list" className="grid gap-1 p-2">
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
                    <Label htmlFor="results-time-filter-start">Start</Label>
                    <Input
                      id="results-time-filter-start"
                      type="datetime-local"
                      value={timeFilterStart}
                      onChange={(event) => setTimeFilterStart(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="results-time-filter-end">End</Label>
                    <Input
                      id="results-time-filter-end"
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
                    <Button type="button" size="sm" onClick={() => setOpenTimeFilterPicker(false)}>
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>
          <Button variant="outline" onClick={() => void loadResults()} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button variant="outline" onClick={pagination.prev} disabled={refreshing || offset === 0}>
            Prev
          </Button>
          <Button variant="outline" onClick={pagination.next} disabled={refreshing || !hasMore}>
            Next
          </Button>
          <Button type="button" variant="outline" className="gap-1.5" onClick={openGlobalAssistant}>
            <Sparkles className="h-4 w-4 text-amber-500" />
            MCP Lab Assistant
          </Button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{pagination.rangeLabel(results.length)}</p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => setDashboardVisible((visible) => !visible)}
          aria-pressed={dashboardVisible}
        >
          <LayoutDashboard className="h-3 w-3" />
          {dashboardVisible ? 'Hide dashboard' : 'Show dashboard'}
        </Button>
      </div>

      {dashboardVisible ? (
        <div className="mt-2">
          <ResultsDashboard runs={dashboardRuns} loading={dashboardLoading} />
        </div>
      ) : null}

      <div
        className={`mt-4 grid gap-6 ${
          assistantOpen
            ? assistantExpanded
              ? 'xl:grid-cols-[minmax(0,1fr)_52rem]'
              : 'xl:grid-cols-[minmax(0,1fr)_30rem]'
            : 'grid-cols-1'
        }`}
      >
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
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
                  <TableHead className="text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('avgToolCalls')}
                    >
                      Avg Tool Calls
                      {sortIcon('avgToolCalls')}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('toolTokens')}
                    >
                      Tool Tokens
                      {sortIcon('toolTokens')}
                    </button>
                  </TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedWithDaySeparators.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={RESULTS_TABLE_COLUMN_COUNT}
                      className="px-4 py-10 text-center text-sm text-muted-foreground"
                    >
                      {timeFilterMode === 'all' && scenarioFilter === 'all'
                        ? 'No runs yet.'
                        : 'No runs match current filters.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedWithDaySeparators.map((item, index) =>
                    item.type === 'day-separator' ? (
                      <TableRow
                        key={`day-${item.dayKey}-${index}`}
                        className="bg-muted/30 hover:bg-muted/30"
                      >
                        <TableCell colSpan={RESULTS_TABLE_COLUMN_COUNT} className="px-4 py-3">
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
                          <div className="space-y-1">
                            <Link
                              to={`/results/${item.run.id}`}
                              className="font-mono text-xs text-primary hover:underline"
                            >
                              {item.run.id}
                            </Link>
                            {item.run.runNote ? (
                              <div className="text-[11px] text-muted-foreground break-words">
                                Note: {item.run.runNote}
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
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
                            {(() => {
                              const totalTimeMs = getRunTotalDurationMs(item.run);
                              if (totalTimeMs === null) return null;
                              return (
                                <div className="font-mono text-[11px] text-muted-foreground/90">
                                  Total time: {formatDurationMs(totalTimeMs)}
                                </div>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            <PassRateBadge rate={item.run.overallPassRate} />
                            <RunFailureSignalBadge run={item.run} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {item.run.totalScenarios}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {item.run.avgToolCalls.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="space-y-0.5">
                            <div className="font-mono text-sm">
                              {formatToolTokenTotal(item.run)}
                            </div>
                            {(() => {
                              const toolTimeMs = getRunToolTimeMs(item.run);
                              if (toolTimeMs === null) return null;
                              return (
                                <div className="font-mono text-[11px] text-muted-foreground/90">
                                  Tool time: {formatDurationMs(toolTimeMs)}
                                </div>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={rerunningRunId === item.run.id}
                              onClick={() => void handleRerun(item.run)}
                            >
                              <Play className="mr-1.5 h-3.5 w-3.5" />
                              {rerunningRunId === item.run.id ? 'Queueing...' : 'Rerun'}
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link to={`/results/${item.run.id}`}>
                                    <Eye className="mr-2 h-3.5 w-3.5" />
                                    View
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <Download className="mr-2 h-3.5 w-3.5" />
                                  Export JSON
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onSelect={(e) => {
                                    e.preventDefault();
                                    const active = document.activeElement;
                                    if (active instanceof HTMLElement) active.blur();
                                    setPendingDeleteRunId(item.run.id);
                                  }}
                                >
                                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  )
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {assistantOpen && (
          <ResultAssistantPanel
            title="MCP Lab Assistant"
            description="Analyze historical differences and trends across all result runs."
            expanded={assistantExpanded}
            onToggleExpanded={() => setAssistantExpanded((prev) => !prev)}
            onHide={() => setAssistantOpen(false)}
            messages={assistantMessages}
            pendingToolCalls={assistantPendingToolCalls}
            loading={assistantLoading}
            onCancel={assistantTurnCancelable ? cancelAssistantTurn : undefined}
            input={assistantInput}
            onInputChange={setAssistantInput}
            onSend={() => void askAssistant()}
            inputPlaceholder="Ask about historical run differences..."
            snippets={RESULT_ASSISTANT_SNIPPETS}
            onSnippetSelect={(prompt) => {
              setAssistantOpen(true);
              applyResultAssistantSnippet(prompt);
            }}
            onApproveToolCall={(callId) => void approveResultAssistantToolCall(callId)}
            onDenyToolCall={(callId) => void denyResultAssistantToolCall(callId)}
            chatEndRef={assistantChatEndRef}
            inputRef={assistantInputRef}
            className="min-w-0 overflow-hidden xl:flex xl:h-[calc(100vh-14rem)] xl:min-h-0 xl:flex-col"
            renderMessage={({
              message,
              index,
              linkedPendingToolCall,
              isUser,
              isAssistant,
              isSystem,
              isTool
            }) => {
              const isAssistantToolRequest = isAssistant && Boolean(message.pendingToolCallId);
              if (
                isTool &&
                /^(Approved|Denied) tool call\b/i.test(String(message.text ?? '').trim())
              ) {
                return null;
              }

              if (isAssistantToolRequest) {
                const displayToolName = formatAssistantToolName(
                  linkedPendingToolCall?.tool ??
                    message.toolRequestName ??
                    linkedPendingToolCall?.publicToolName ??
                    message.toolRequestPublicName ??
                    'unknown_tool'
                );
                return (
                  <div
                    key={`${message.id ?? `${message.role}-${index}`}:tool`}
                    className="flex items-start gap-2"
                  >
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                      <Bot className="h-3 w-3" />
                    </div>
                    <details
                      open={Boolean(linkedPendingToolCall)}
                      className="group min-w-0 w-full max-w-[92%] overflow-hidden rounded-md border border-border/60 bg-background"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 truncate text-sm font-medium">{`Tool call ${displayToolName}`}</span>
                            <span
                              className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                linkedPendingToolCall
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {linkedPendingToolCall ? 'Needs approval' : 'Completed'}
                            </span>
                          </div>
                        </div>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="min-w-0 space-y-2 border-t border-border/50 px-3 py-2">
                        <MarkdownContent text={message.text} className="text-sm" />
                      </div>
                    </details>
                  </div>
                );
              }

              return (
                <div
                  key={message.id ?? `${message.role}-${index}`}
                  className={`flex items-start gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                      {isSystem ? (
                        <RectangleEllipsis className="h-3 w-3" />
                      ) : (
                        <Bot className="h-3 w-3" />
                      )}
                    </div>
                  )}
                  <div
                    className={`min-w-0 max-w-[92%] break-words rounded-md border p-3 text-sm ${
                      isUser
                        ? 'border-primary/20 bg-primary/10'
                        : isSystem
                        ? 'border-amber-400/30 bg-amber-50/70'
                        : isTool
                        ? 'border-blue-300/30 bg-blue-50/50'
                        : 'border-border/80 bg-background shadow-sm'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{message.text}</p>
                    ) : (
                      <MarkdownContent text={message.text} className="text-sm" />
                    )}
                  </div>
                  {isUser && (
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                      <User className="h-3 w-3" />
                    </div>
                  )}
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Results;
