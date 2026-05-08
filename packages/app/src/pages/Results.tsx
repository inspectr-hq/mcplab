import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Clock,
  MoreHorizontal,
  Eye,
  Download,
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
import { useDataSource } from '@/contexts/DataSourceContext';
import { useResultAssistant } from '@/hooks/use-result-assistant';
import { toast } from '@/hooks/use-toast';
import { formatAssistantToolName } from '@/lib/assistant-tool-name';
import { buildRunScopeSummary, type RunScopeSummary } from '@/lib/run-scope-summary';
import type { EvalResult } from '@/types/eval';

type TimeFilterPreset = '15min' | '1h' | '24h' | '7d' | '30d';
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

const TIME_FILTER_PRESETS: Array<{ value: TimeFilterPreset; label: string; durationMs: number }> = [
  { value: '15min', label: 'Last 15min', durationMs: 15 * 60 * 1000 },
  { value: '1h', label: 'Last hour', durationMs: 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 hours', durationMs: 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
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
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalDayLabel(value: string) {
  const parsed = parseLocalDateTime(value);
  if (!parsed) return 'Unknown day';
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function isTimeFilterMode(value: string | null): value is TimeFilterMode {
  return value === 'all' || value === 'last' || value === 'custom';
}

function isTimeFilterPreset(value: string | null): value is TimeFilterPreset {
  return (
    value === '15min' || value === '1h' || value === '24h' || value === '7d' || value === '30d'
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

const Results = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { source } = useDataSource();
  const initialTimeFilter = getTimeFilterQueryState(searchParams);
  const [results, setResults] = useState<EvalResult[]>([]);
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
      setResults(await source.listResults());
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
    source
      .listResults()
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
  }, [source]);

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

  const filteredResults = useMemo(() => {
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
  }, [results, scenarioFilter, timeFilterEnd, timeFilterMode, timeFilterPreset, timeFilterStart]);

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
      map.set(run.id, buildRunScopeSummary(run));
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

  return (
    <div className="space-y-6">
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
                className="w-[260px] justify-between font-normal"
              >
                <span className="truncate text-left">{selectedScenarioFilterLabel}</span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[260px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search scenarios..." />
                <CommandList>
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
                className="w-[320px] justify-between font-normal"
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
              <div className="grid gap-1 p-2">
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
          <Button type="button" variant="outline" className="gap-1.5" onClick={openGlobalAssistant}>
            <Sparkles className="h-4 w-4 text-amber-500" />
            MCP Lab Assistant
          </Button>
        </div>
      </div>

      <div
        className={`grid gap-6 ${
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
                {sortedWithDaySeparators.map((item, index) =>
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
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(item.run.timestamp).toLocaleString()}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <PassRateBadge rate={item.run.overallPassRate} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {item.run.totalScenarios}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {item.run.avgToolCalls.toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatToolTokenTotal(item.run)}
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                    </TableRow>
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
