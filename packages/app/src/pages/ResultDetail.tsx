import { scenarioExecutionKey } from '@/lib/data-sources/types';
import { calculatePassRate } from '@/types/eval';
import { formatPassRate } from '@/lib/utils';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowLeftRight,
  Activity,
  BarChart3,
  Timer,
  Layers,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Download,
  User,
  Bot,
  Wrench,
  Sparkles,
  Loader2,
  PanelRightOpen,
  PanelRightClose,
  NotepadText,
  Plus,
  Clock,
  Clock3,
  Play,
  Pencil,
  FileCode,
  Trash2,
  GitCompare
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { StatCard } from '@/components/StatCard';
import { ResultAssistantPanel } from '@/components/results/ResultAssistantPanel';
import { OutcomeCard } from '@/components/results/ResultsDashboard';
import { McpServerBadge } from '@/components/results/McpServerBadge';
import { ScenarioResultsTable } from '@/components/results/ScenarioResultsTable';
import { ScenarioResultsComparison } from '@/components/results/ScenarioResultsComparison';
import { formatCompactOneDecimal } from '@/lib/format-duration';
import { isScenarioAssistantHandoffRelevant } from '@/lib/scenario-assistant';
import { MarkdownContent } from '@/components/MarkdownContent';
import { PassRateBadge } from '@/components/PassRateBadge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { generateHtmlReport } from '@/lib/generate-html-report';
import { sumTokenUsages } from '@/lib/token-usage';
import { formatTokenCount } from '@/lib/format-duration';
import { useDataSource } from '@/contexts/useDataSource';
import { useConfigs } from '@/contexts/useConfigs';
import { useLibraries } from '@/contexts/useLibraries';
import { useResultAssistant } from '@/hooks/use-result-assistant';
import { toast } from '@/hooks/use-toast';
import { buildCheckItems, formatCheckStatusLabel } from '@/lib/check-presentation';
import { tallyCheckCounts } from '@/types/eval';
import { formatProvider } from '@/lib/provider-format';
import { rerunWithSameSettings } from '@/lib/rerun-run';
import { useMcpServerNames } from '@/hooks/use-mcp-server-names';
import {
  formatDurationMs,
  getRunToolTimeMs,
  getRunTotalDurationMs,
  getScenarioToolTimeMs,
  getScenarioTotalDurationMs
} from '@/lib/run-duration';
import type { EvalResult, EvalConfig as UiEvalConfig } from '@/types/eval';
import type { MarkdownReportContent, MarkdownReportSummary } from '@/lib/data-sources/types';

const RESULT_ASSISTANT_HANDOFF_STORAGE_KEY = 'mcplab.resultAssistantScenarioHandoff';
const RESULT_ASSISTANT_SNIPPETS = [
  {
    label: 'Summarize Run Results',
    description: 'Highlight failures first, then notable tool usage and extracted values.',
    prompt:
      'Summarize the scenario results in this run. Highlight failed scenarios/checks first, then mention notable tool usage and extracted values.'
  },
  {
    label: 'Compare Agent Answer Quality',
    description: 'Rank agents by completeness, depth, and recommendation quality.',
    prompt:
      'Compare the answer quality across all agents for this run. Rank them by completeness, analytical depth, and usefulness of recommendations. Highlight concrete differences in tool usage.'
  },
  {
    label: 'Explain Key Failures',
    description: 'Use traces and tool outputs to identify likely root causes.',
    prompt:
      'Identify the most important failures in this run and explain likely root causes using the trace and tool outputs.'
  },
  {
    label: 'Compare With Previous Run',
    description: 'Summarize changes in outcomes, tool usage, and extracted values.',
    prompt:
      'Compare this run with the previous run and summarize changes in outcomes, tool usage, and extracted values.'
  }
] as const;

function defaultResultAssistantReportPath(runId: string): string {
  const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+/, '');
  return `mcplab/reports/result-assistant/${runId}-${stamp}.md`;
}

function getServerVersionsForVariant(
  result: EvalResult,
  variantId: string
): Record<string, string | null> {
  if (!variantId) return result.mcpServerVersions;
  const variant = result.server_variants?.find((candidate) => candidate.id === variantId);
  if (!variant) return result.mcpServerVersions;
  const serverIds =
    variant.serverIds ??
    result.scenarios.find((scenario) => scenario.server_variant === variantId)?.servers;
  if (!serverIds) return result.mcpServerVersions;
  return Object.fromEntries(
    serverIds
      .filter((serverId) => serverId in result.mcpServerVersions)
      .map((serverId) => [serverId, result.mcpServerVersions[serverId]] as const)
  );
}

const ResultDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { source } = useDataSource();
  const isEmbedded = searchParams.get('embed') === '1';
  const { configs } = useConfigs();
  const { scenarios: libraryScenarios } = useLibraries();
  const mcpServerNames = useMcpServerNames();
  const [result, setResult] = useState<EvalResult | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [editingRunNote, setEditingRunNote] = useState(false);
  const [runNoteDraft, setRunNoteDraft] = useState('');
  const [savingRunNote, setSavingRunNote] = useState(false);
  const [openScenarios, setOpenScenarios] = useState<Set<string>>(new Set());
  const [collapsedRunSections, setCollapsedRunSections] = useState<Set<string>>(new Set());
  const [scenarioCompareMode, setScenarioCompareMode] = useState(false);
  const [scenarioCompareKeys, setScenarioCompareKeys] = useState<[string, string]>(['', '']);
  const swapScenarioCompare = useCallback(
    () => setScenarioCompareKeys(([left, right]) => [right, left]),
    []
  );
  const [targetConfigId, setTargetConfigId] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [contextPanelTab, setContextPanelTab] = useState<'assistant' | 'reports' | 'note'>(
    'assistant'
  );
  const [assistantContextScenarioId, setAssistantContextScenarioId] = useState<string | null>(null);

  const [applyReportOpen, setApplyReportOpen] = useState(false);
  const [applyReportMarkdown, setApplyReportMarkdown] = useState('');
  const [applyReportOutputPath, setApplyReportOutputPath] = useState('');
  const [applyReportOverwrite, setApplyReportOverwrite] = useState(false);
  const [applyReportPending, setApplyReportPending] = useState(false);
  const [applyReportIsManual, setApplyReportIsManual] = useState(false);
  const [referenceReports, setReferenceReports] = useState<MarkdownReportSummary[]>([]);
  const [referenceReportsLoading, setReferenceReportsLoading] = useState(false);
  const [selectedReferenceReportPath, setSelectedReferenceReportPath] = useState('');
  const [selectedReferenceReport, setSelectedReferenceReport] =
    useState<MarkdownReportContent | null>(null);
  const [selectedReferenceReportLoading, setSelectedReferenceReportLoading] = useState(false);
  const [selectedReferenceReportError, setSelectedReferenceReportError] = useState<string | null>(
    null
  );
  const [deleteRunOpen, setDeleteRunOpen] = useState(false);
  const [deletingRun, setDeletingRun] = useState(false);
  const [rerunningRun, setRerunningRun] = useState(false);
  const headerRowRef = useRef<HTMLDivElement | null>(null);
  const [hideDeleteLabel, setHideDeleteLabel] = useState(false);
  const {
    assistantMessages,
    assistantPendingToolCalls,
    assistantInput,
    assistantLoading,
    assistantTurnCancelable,
    assistantExpired,
    cancelAssistantTurn,
    assistantInputRef,
    setAssistantInput,
    askAssistant: askResultAssistant,
    approveResultAssistantToolCall,
    denyResultAssistantToolCall,
    applyResultAssistantSnippet,
    ensureIntroMessage,
    resetAssistantSession
  } = useResultAssistant({
    source,
    open: assistantOpen,
    scope: 'run',
    runId: id,
    onSessionSync: undefined
  });

  const refreshReferenceReports = useCallback(
    async (runId: string, preferredPath?: string) => {
      setReferenceReportsLoading(true);
      try {
        const items = await source.listMarkdownReports();
        const filtered = items.filter((item) => {
          const path = String(item.relativePath ?? '');
          const name = String(item.name ?? '');
          return path.includes(runId) || name.includes(runId);
        });
        setReferenceReports(filtered);
        if (preferredPath && filtered.length > 0) {
          const matched = filtered.find(
            (report) =>
              report.relativePath === preferredPath ||
              report.path === preferredPath ||
              report.relativePath.endsWith(preferredPath) ||
              report.path.endsWith(preferredPath)
          );
          if (matched) {
            setSelectedReferenceReportPath(matched.relativePath);
          }
        }
        return filtered;
      } catch {
        setReferenceReports([]);
        return [];
      } finally {
        setReferenceReportsLoading(false);
      }
    },
    [source]
  );

  useEffect(() => {
    if (!id) return;
    let active = true;
    resetAssistantSession();
    setLoading(true);
    source.getResult(id).then((next) => {
      if (active) {
        setResult(next);
        setRunNoteDraft(next?.runNote ?? '');
        setEditingRunNote(false);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [id, source, resetAssistantSession]);

  useEffect(() => {
    const node = headerRowRef.current;
    if (!node) return;

    const update = () => {
      setHideDeleteLabel(node.clientWidth < 800);
    };

    update();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => update());
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [loading]);

  useEffect(() => {
    if (!result?.id) {
      setReferenceReports([]);
      return;
    }
    let active = true;
    void (async () => {
      const items = await refreshReferenceReports(result.id);
      if (!active) return;
      // Prevent state updates from a stale effect after run id changes quickly.
      if (!items) return;
    })();
    return () => {
      active = false;
    };
  }, [result?.id, refreshReferenceReports]);

  useEffect(() => {
    if (referenceReports.length === 0) {
      setSelectedReferenceReportPath('');
      setSelectedReferenceReport(null);
      setSelectedReferenceReportError(null);
      return;
    }
    if (
      !selectedReferenceReportPath ||
      !referenceReports.some((r) => r.relativePath === selectedReferenceReportPath)
    ) {
      setSelectedReferenceReportPath(referenceReports[0].relativePath);
    }
  }, [referenceReports, selectedReferenceReportPath]);

  useEffect(() => {
    if (!assistantOpen || contextPanelTab !== 'reports') return;
    if (!selectedReferenceReportPath) {
      setSelectedReferenceReport(null);
      setSelectedReferenceReportError(null);
      return;
    }
    let active = true;
    setSelectedReferenceReportLoading(true);
    setSelectedReferenceReportError(null);
    source
      .getMarkdownReport(selectedReferenceReportPath)
      .then((report) => {
        if (!active) return;
        setSelectedReferenceReport(report);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSelectedReferenceReport(null);
        setSelectedReferenceReportError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setSelectedReferenceReportLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assistantOpen, contextPanelTab, selectedReferenceReportPath, source]);

  const requestedConfigId = searchParams.get('configId') ?? '';
  const requestedAgentId = (searchParams.get('agent') ?? '').trim();
  const requestedVariantId = (searchParams.get('variant') ?? '').trim();
  const hasResultFilter = Boolean(requestedAgentId || requestedVariantId);
  const activeConfig = useMemo(() => {
    const byRequested = requestedConfigId
      ? configs.find((c) => c.id === requestedConfigId)
      : undefined;
    if (byRequested) return byRequested;
    if (!result) return undefined;
    const resultPath = result.configPath?.trim();
    const resultName = result.configName?.trim();
    const byId = configs.find((config) => config.id === result.configId);
    if (byId) return byId;
    const pathCandidates = (config: (typeof configs)[number]) => [
      config.relativePath,
      config.sourcePath,
      config.suitePath
    ];
    const exactPathMatch = resultPath
      ? configs.find((config) =>
          pathCandidates(config).some((candidate) => candidate?.trim() === resultPath)
        )
      : undefined;
    if (exactPathMatch) return exactPathMatch;
    const suffixPathMatch = resultPath
      ? configs.find((config) =>
          pathCandidates(config).some((candidate) => candidate?.endsWith(`/${resultPath}`) === true)
        )
      : undefined;
    if (suffixPathMatch) return suffixPathMatch;
    return configs.find((config) =>
      resultName ? config.name === resultName || config.configName === resultName : false
    );
  }, [configs, requestedConfigId, result]);
  const resultConfigLabel = useMemo(() => {
    const explicitName = result?.configName?.trim();
    if (explicitName) return explicitName;
    const explicitPath = result?.configPath?.trim();
    if (explicitPath) return explicitPath;
    const fromActive = activeConfig?.relativePath?.trim() || activeConfig?.name?.trim();
    if (fromActive) return fromActive;
    const explicitId = result?.configId?.trim();
    return explicitId || '';
  }, [result, activeConfig]);
  const resultEvalName = useMemo(() => {
    const explicitName = result?.configName?.trim();
    if (explicitName) return explicitName;
    return activeConfig?.name?.trim() || '';
  }, [result, activeConfig]);
  const resultConfigPath = useMemo(() => {
    const explicitPath = result?.configPath?.trim();
    if (explicitPath) return explicitPath;
    return activeConfig?.relativePath?.trim() || '';
  }, [result, activeConfig]);
  const scenarioDefinitionByResultId = useMemo(() => {
    const map = new Map<string, UiEvalConfig['scenarios'][number]>();
    if (activeConfig) {
      for (const scenario of activeConfig.scenarios) {
        map.set(scenario.id, scenario);
        if (scenario.name && !map.has(scenario.name)) map.set(scenario.name, scenario);
      }
      for (const entry of activeConfig.scenarioEntries ?? []) {
        if (entry.kind !== 'referenced') continue;
        const libScenario = libraryScenarios.find((s) => s.id === entry.ref);
        if (libScenario) {
          map.set(libScenario.id, libScenario);
          if (libScenario.name) map.set(libScenario.name, libScenario);
          if (!map.has(entry.ref)) map.set(entry.ref, libScenario);
        }
      }
    }
    // Broader fallback for refs-only configs where we only know result scenario ids.
    for (const libScenario of libraryScenarios) {
      if (!map.has(libScenario.id)) map.set(libScenario.id, libScenario);
      if (libScenario.name && !map.has(libScenario.name)) map.set(libScenario.name, libScenario);
    }
    return map;
  }, [activeConfig, libraryScenarios]);
  const inferredConfigId = useMemo(() => '', []);

  useEffect(() => {
    if (requestedConfigId && configs.some((config) => config.id === requestedConfigId)) {
      setTargetConfigId(requestedConfigId);
      return;
    }
    if (inferredConfigId) {
      setTargetConfigId((prev) => prev || inferredConfigId);
    }
  }, [requestedConfigId, configs, inferredConfigId]);

  const {
    filteredScenarios,
    filteredTotalRuns,
    filteredPassCount,
    displayPassRate,
    displayAvgToolCalls,
    displayAvgLatency,
    displayDurationMs,
    displayToolTimeMs,
    displayToolTokenUsage,
    filteredStoppedRuns
  } = useMemo(() => {
    if (!result) {
      return {
        filteredScenarios: [] as EvalResult['scenarios'],
        filteredTotalRuns: 0,
        filteredPassCount: 0,
        displayPassRate: 0,
        displayAvgToolCalls: 0,
        displayAvgLatency: 0,
        displayDurationMs: null as number | null,
        displayToolTimeMs: null as number | null,
        displayToolTokenUsage: null,
        filteredStoppedRuns: 0
      };
    }
    const scenarios = result.scenarios.filter(
      (scenario) =>
        (!requestedAgentId ||
          scenario.agentId === requestedAgentId ||
          scenario.agentName === requestedAgentId) &&
        (!requestedVariantId || scenario.server_variant === requestedVariantId)
    );
    const scenarioRunCount = scenarios.reduce((sum, scenario) => sum + scenario.runs.length, 0);
    const scenarioPassCount = scenarios.reduce(
      (sum, scenario) => sum + scenario.runs.filter((run) => run.passed).length,
      0
    );
    const scenarioStoppedCount = scenarios.reduce(
      (sum, scenario) => sum + scenario.runs.filter((run) => run.outcome === 'stopped').length,
      0
    );
    const totalRuns = !hasResultFilter && result.outcomes ? result.totalRuns : scenarioRunCount;
    const passCount =
      !hasResultFilter && result.outcomes?.passed !== undefined
        ? result.outcomes.passed
        : scenarioPassCount;
    const stoppedRuns =
      !hasResultFilter && result.outcomes?.stopped !== undefined
        ? result.outcomes.stopped
        : scenarioStoppedCount;
    const totalToolCalls = scenarios.reduce(
      (sum, scenario) =>
        sum + scenario.runs.reduce((runsSum, run) => runsSum + run.toolCalls.length, 0),
      0
    );
    const totalDuration = getRunTotalDurationMs({ ...result, scenarios });
    const totalToolDuration = getRunToolTimeMs({ ...result, scenarios });
    return {
      filteredScenarios: scenarios,
      filteredTotalRuns: totalRuns,
      filteredPassCount: passCount,
      displayPassRate: calculatePassRate(passCount, totalRuns, stoppedRuns),
      displayAvgToolCalls: totalRuns === 0 ? 0 : totalToolCalls / totalRuns,
      displayAvgLatency:
        totalRuns === 0 || totalDuration === null ? 0 : Math.round(totalDuration / totalRuns),
      displayDurationMs: totalDuration,
      displayToolTimeMs: totalToolDuration,
      displayToolTokenUsage: sumTokenUsages(scenarios.map((scenario) => scenario.toolTokenUsage)),
      filteredStoppedRuns: stoppedRuns
    };
  }, [result, requestedAgentId, requestedVariantId, hasResultFilter]);

  const toolData = useMemo(() => {
    const toolFreq: Record<string, number> = {};
    filteredScenarios.forEach((sc) =>
      sc.runs.forEach((r) =>
        r.toolCalls.forEach((tc) => {
          toolFreq[tc.name] = (toolFreq[tc.name] || 0) + 1;
        })
      )
    );
    return Object.entries(toolFreq)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredScenarios]);

  const scenarioCompareOptions = useMemo(
    () =>
      filteredScenarios.map((scenario) => ({
        key: scenarioExecutionKey(scenario.scenarioId, scenario.agentName, scenario.server_variant),
        label: scenario.scenarioName || scenario.scenarioId
      })),
    [filteredScenarios]
  );

  useEffect(() => {
    if (scenarioCompareOptions.length < 2) {
      setScenarioCompareMode(false);
      setScenarioCompareKeys(['', '']);
      return;
    }
    setScenarioCompareKeys(([left, right]) => [
      scenarioCompareOptions.some((option) => option.key === left)
        ? left
        : scenarioCompareOptions[0].key,
      scenarioCompareOptions.some((option) => option.key === right && option.key !== left)
        ? right
        : scenarioCompareOptions[1].key
    ]);
  }, [scenarioCompareOptions]);

  if (loading)
    return <div className="p-8 text-center text-muted-foreground">Loading result...</div>;
  if (!result) return <div className="p-8 text-center text-muted-foreground">Result not found</div>;

  const checkCounts = tallyCheckCounts(
    filteredScenarios.flatMap((scenario) => scenario.runs.flatMap((run) => run.checkResults ?? []))
  );
  const runOutcomes = filteredScenarios.flatMap((scenario) => scenario.runs);
  const incompleteRuns =
    !hasResultFilter && result.outcomes?.incomplete !== undefined
      ? result.outcomes.incomplete
      : runOutcomes.filter((run) => run.outcome === 'incomplete').length;
  const errorRuns =
    !hasResultFilter && result.outcomes?.error !== undefined
      ? result.outcomes.error
      : runOutcomes.filter((run) => run.outcome === 'error').length;
  const stoppedRuns = filteredStoppedRuns;

  const toggle = (rowId: string) => {
    setOpenScenarios((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const runSectionKey = (
    executionKey: string,
    runIndex: number,
    section: 'checks' | 'extracts' | 'tools' | 'final' | 'conversation'
  ) => `${JSON.stringify([executionKey, runIndex])}:${section}`;

  const toggleRunSection = (key: string) => {
    setCollapsedRunSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const isRunSectionOpen = (key: string, defaultOpen = !key.endsWith(':conversation')) => {
    return collapsedRunSections.has(key) ? !defaultOpen : defaultOpen;
  };
  const openAssistantWithPrompt = (prompt?: string, options?: { scenarioId?: string }) => {
    setContextPanelTab('assistant');
    setAssistantOpen(true);
    setAssistantContextScenarioId(options?.scenarioId ?? null);
    ensureIntroMessage(
      'Ask me to explain failures, tool usage, or suggest what to inspect next in this result.'
    );
    if (prompt) {
      setAssistantInput(prompt);
    }
  };
  const toggleAssistantPanel = () => {
    if (assistantOpen) {
      setAssistantOpen(false);
      return;
    }
    openAssistantWithPrompt();
  };

  const openReportsPanel = (relativePath?: string) => {
    if (relativePath) setSelectedReferenceReportPath(relativePath);
    setContextPanelTab('reports');
    setAssistantOpen(true);
  };

  const openRunNotePanel = () => {
    setContextPanelTab('note');
    setAssistantOpen(true);
  };

  const sendToScenarioAssistant = (assistantReply: string) => {
    if (!result) return;
    if (!assistantContextScenarioId) {
      toast({
        title: 'No scenario context',
        description: 'Ask about a specific scenario or run first, then send the suggestion.',
        variant: 'destructive'
      });
      return;
    }
    const libScenario =
      libraryScenarios.find((s) => s.id === assistantContextScenarioId) ??
      libraryScenarios.find((s) => s.name === assistantContextScenarioId);
    if (!libScenario) {
      toast({
        title: 'Scenario not found in library',
        description: `Could not find library scenario '${assistantContextScenarioId}' to open in Scenario Assistant.`,
        variant: 'destructive'
      });
      return;
    }
    const prompt = [
      `I am sending a suggestion from the Result Assistant for scenario '${assistantContextScenarioId}' based on run '${result.id}'.`,
      'Please review the suggestion, check it against the current scenario configuration, and propose concrete updates to the Checks and/or Value Capture Rules if appropriate.',
      '',
      'Result Assistant suggestion:',
      assistantReply
    ].join('\n');
    try {
      window.sessionStorage.setItem(
        RESULT_ASSISTANT_HANDOFF_STORAGE_KEY,
        JSON.stringify({
          type: 'result-assistant-handoff-v1',
          runId: result.id,
          configId: requestedConfigId || result.configId || '',
          scenarioId: libScenario.id,
          prompt,
          sourceReply: assistantReply
        })
      );
      navigate(`/libraries/test-cases/${encodeURIComponent(libScenario.id)}?assistantHandoff=1`);
    } catch (error: unknown) {
      toast({
        title: 'Could not create handoff',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    }
  };

  const openApplyReportDialog = (assistantReply: string) => {
    if (!result) return;
    setApplyReportIsManual(false);
    setApplyReportMarkdown(assistantReply);
    setApplyReportOutputPath(defaultResultAssistantReportPath(result.id));
    setApplyReportOverwrite(false);
    setApplyReportOpen(true);
  };

  const openManualReportDialog = () => {
    if (!result) return;
    setApplyReportIsManual(true);
    setApplyReportMarkdown('');
    setApplyReportOutputPath(defaultResultAssistantReportPath(result.id));
    setApplyReportOverwrite(false);
    setApplyReportOpen(true);
  };

  const applyAssistantReport = async () => {
    if (!result) return;
    const markdown = applyReportMarkdown.trim();
    if (!markdown) {
      toast({
        title: 'No markdown to write',
        description: 'The selected assistant response is empty.',
        variant: 'destructive'
      });
      return;
    }
    setApplyReportPending(true);
    try {
      const response = await source.applyResultAssistantReport({
        runId: result.id,
        markdown: applyReportMarkdown,
        outputPath: applyReportOutputPath.trim() || undefined,
        overwrite: applyReportOverwrite
      });
      toast({
        title: 'Markdown report written',
        description:
          typeof response.path === 'string' && response.path ? response.path : response.outputPath
      });
      await refreshReferenceReports(
        result.id,
        (typeof response.path === 'string' && response.path) || response.outputPath || undefined
      );
      if (assistantOpen) {
        setContextPanelTab('reports');
      }
      setApplyReportOpen(false);
    } catch (error: unknown) {
      toast({
        title: 'Could not write markdown report',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setApplyReportPending(false);
    }
  };

  const saveRunNote = async () => {
    if (!result) return;
    setSavingRunNote(true);
    try {
      const trimmed = runNoteDraft.trim();
      await source.updateRunNote(result.id, trimmed || undefined);
      setResult((prev) => (prev ? { ...prev, runNote: trimmed || undefined } : prev));
      setRunNoteDraft(trimmed);
      setEditingRunNote(false);
      toast({ title: 'Run note saved' });
    } catch (error: unknown) {
      toast({
        title: 'Could not save run note',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setSavingRunNote(false);
    }
  };

  const deleteRun = async () => {
    if (!result?.id) return;
    setDeletingRun(true);
    try {
      await source.deleteResult(result.id);
      toast({ title: 'Run deleted', description: result.id });
      navigate('/results');
    } catch (error: unknown) {
      toast({
        title: 'Could not delete run',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setDeletingRun(false);
      setDeleteRunOpen(false);
    }
  };

  const rerunResult = async () => {
    if (!result?.id) return;
    const configPath = resultConfigPath.trim();
    if (!configPath) {
      toast({
        title: 'Cannot rerun',
        description: 'This run has no config path in metadata.',
        variant: 'destructive'
      });
      return;
    }
    setRerunningRun(true);
    try {
      await rerunWithSameSettings(source, { ...result, configPath });
      toast({
        title: 'Rerun queued',
        description: `${result.id} queued with previous run settings.`
      });
    } catch (error: unknown) {
      toast({
        title: 'Could not rerun',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setRerunningRun(false);
    }
  };

  return (
    <div
      className={`${
        assistantOpen
          ? 'xl:flex xl:h-[calc(100vh-2rem-48px)] xl:min-h-0 xl:flex-col xl:overflow-hidden'
          : ''
      }`}
    >
      <div className={`${assistantOpen ? 'xl:shrink-0 xl:pb-6' : 'mb-6'}`}>
        <div ref={headerRowRef} className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {!isEmbedded && (
              <Button variant="ghost" size="icon" asChild>
                <Link to="/results">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold font-mono">{result.id}</h1>
                <PassRateBadge rate={displayPassRate} />
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 align-middle">
                  <Clock3 className="h-3 w-3 shrink-0" />
                  {new Date(result.timestamp).toLocaleString()}
                </span>
                <span className="mx-1">·</span>
                {requestedVariantId && (
                  <Badge variant="outline">
                    Server set:{' '}
                    {result.server_variants?.find((variant) => variant.id === requestedVariantId)
                      ?.label || requestedVariantId}
                  </Badge>
                )}
                {requestedAgentId ? (
                  <>
                    <span className="inline-flex items-center align-middle">
                      Agent: {requestedAgentId}
                    </span>
                    <span className="mx-1">·</span>
                  </>
                ) : null}
                {resultEvalName ? (
                  <span className="inline-flex items-center align-middle">
                    Eval: <span className="ml-1 font-medium">{resultEvalName}</span>
                  </span>
                ) : null}
                {resultEvalName && resultConfigPath ? <span className="mx-1">·</span> : null}
                {resultConfigPath ? (
                  <span className="inline-flex items-center align-middle">
                    Path: <span className="ml-1 font-mono">{resultConfigPath}</span>
                  </span>
                ) : null}
                {!resultEvalName && !resultConfigPath && resultConfigLabel ? (
                  <span className="inline-flex items-center align-middle">
                    Config: <span className="ml-1 font-mono">{resultConfigLabel}</span>
                  </span>
                ) : null}
                {result.executionSource ? (
                  <>
                    {(resultEvalName || resultConfigPath || resultConfigLabel) && (
                      <span className="mx-1">·</span>
                    )}
                    <span className="inline-flex items-center align-middle">
                      Source: <span className="ml-1 font-medium">{result.executionSource}</span>
                      {result.executionClient ? (
                        <span className="ml-1">({result.executionClient})</span>
                      ) : null}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex w-full min-w-0 items-center justify-between gap-2 sm:ml-auto sm:w-auto">
            {!isEmbedded && (
              <McpServerBadge
                versions={result.mcpServerVersions}
                serverNames={mcpServerNames}
                size="compact"
              />
            )}
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="max-w-full px-2"
                onClick={() => {
                  const html = generateHtmlReport(result);
                  const blob = new Blob([html], { type: 'text/html' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `mcplab-report-${result.id}.html`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                aria-label="Download Report"
                title="Download Report"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-w-full gap-1.5"
                onClick={() => openReportsPanel()}
                disabled={referenceReportsLoading}
                title="Show reports for this run"
              >
                <NotepadText className="h-3.5 w-3.5" />
                {referenceReportsLoading
                  ? 'Reports...'
                  : `Reports${referenceReports.length ? ` (${referenceReports.length})` : ''}`}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-w-full gap-1.5"
                aria-label="Run Note"
                title="View or edit the run note"
                onClick={() => openRunNotePanel()}
              >
                <NotepadText className="h-3.5 w-3.5" />
                {hideDeleteLabel ? 'Note' : 'Run Note'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-w-full gap-1.5"
                aria-label="MCP Lab Assistant"
                title="Ask the MCP Lab Assistant about this result"
                onClick={toggleAssistantPanel}
              >
                <Sparkles className="h-4 w-4 text-amber-500" />
                Assistant
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-w-full gap-1.5"
                onClick={() => void rerunResult()}
                disabled={rerunningRun || !resultConfigPath.trim()}
                title="Queue this evaluation again with the same settings"
              >
                <Play className="h-3.5 w-3.5" />
                {rerunningRun ? 'Queueing...' : 'Rerun'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-w-full gap-1.5 text-destructive"
                onClick={() => setDeleteRunOpen(true)}
                disabled={deletingRun}
                aria-label={deletingRun ? 'Deleting run' : 'Delete run'}
                title="Delete this run"
              >
                {deletingRun ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {!hideDeleteLabel ? (deletingRun ? 'Deleting...' : 'Delete') : null}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`grid gap-6 items-start ${
          assistantOpen
            ? assistantExpanded
              ? 'xl:grid-cols-[minmax(0,1fr)_52rem] xl:flex-1 xl:min-h-0 xl:overflow-hidden'
              : 'xl:grid-cols-[minmax(0,1fr)_28rem] xl:flex-1 xl:min-h-0 xl:overflow-hidden'
            : 'grid-cols-1'
        }`}
      >
        <div
          className={`min-w-0 space-y-6 ${
            assistantOpen ? 'xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-2' : ''
          }`}
        >
          <div
            className={`grid gap-4 ${
              assistantOpen ? 'grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-8'
            }`}
          >
            <StatCard title="Scenarios" value={filteredScenarios.length} icon={Layers} />
            <StatCard title="Total Runs" value={filteredTotalRuns} icon={Activity} />
            <StatCard title="Pass Rate" value={formatPassRate(displayPassRate)} icon={BarChart3} />
            <StatCard
              title="Avg Tool Calls"
              value={formatCompactOneDecimal(displayAvgToolCalls)}
              icon={CheckCircle2}
            />
            <StatCard title="Avg Latency" value={`${displayAvgLatency}ms`} icon={Timer} />
            {displayDurationMs !== null ? (
              <StatCard
                title="Total Time"
                value={formatDurationMs(displayDurationMs)}
                icon={Clock}
              />
            ) : null}
            {displayToolTimeMs !== null ? (
              <StatCard
                title="Tool Duration"
                value={formatDurationMs(displayToolTimeMs)}
                icon={Clock}
              />
            ) : null}
            <StatCard
              title="Tool Tokens"
              value={formatTokenCount(displayToolTokenUsage?.totalTokens)}
              icon={Wrench}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            <OutcomeCard
              title="Runs Pass / Fail"
              passed={filteredPassCount}
              failed={Math.max(
                0,
                filteredTotalRuns - filteredPassCount - incompleteRuns - errorRuns - stoppedRuns
              )}
              incomplete={incompleteRuns}
              error={errorRuns}
              stopped={stoppedRuns}
            />
            <OutcomeCard
              title="Checks Pass / Fail"
              passed={checkCounts.passed}
              failed={checkCounts.failed}
              notEvaluated={checkCounts.not_evaluated}
              notExecuted={checkCounts.not_executed}
            />

            <Card className="lg:col-span-2">
              <CardHeader className="p-2.5 pb-0">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Tool Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={toolData} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(38, 92%, 50%)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="px-4 pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <CardTitle className="text-base">Scenarios</CardTitle>
                  {isEmbedded && (
                    <McpServerBadge
                      versions={getServerVersionsForVariant(result, requestedVariantId)}
                      serverNames={mcpServerNames}
                      size="compact"
                      className="max-w-none"
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {scenarioCompareMode ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-2 text-xs"
                      onClick={swapScenarioCompare}
                      title="Swap compared scenarios"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Swap
                    </Button>
                  ) : null}
                  {scenarioCompareOptions.length > 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-2 text-xs"
                      onClick={() => setScenarioCompareMode((previous) => !previous)}
                    >
                      <GitCompare className="h-3.5 w-3.5" />
                      {scenarioCompareMode ? 'Exit compare' : 'Compare scenarios'}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-xs"
                    onClick={() =>
                      openAssistantWithPrompt(
                        `Summarize the scenario results in this run. Highlight failed scenarios/checks first, then mention notable tool usage and extracted values.`
                      )
                    }
                  >
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    Ask Assistant
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {scenarioCompareMode && scenarioCompareKeys[0] && scenarioCompareKeys[1] ? (
                <ScenarioResultsComparison
                  result={result}
                  scenarios={filteredScenarios}
                  leftKey={scenarioCompareKeys[0]}
                  rightKey={scenarioCompareKeys[1]}
                  onLeftChange={(value) => setScenarioCompareKeys(([, right]) => [value, right])}
                  onRightChange={(value) => setScenarioCompareKeys(([left]) => [left, value])}
                  mcpServerNames={mcpServerNames}
                  scenarioDefinitionByResultId={scenarioDefinitionByResultId}
                />
              ) : (
                <ScenarioResultsTable
                  result={result}
                  filteredScenarios={filteredScenarios}
                  isEmbedded={isEmbedded}
                  mcpServerNames={mcpServerNames}
                  openScenarios={openScenarios}
                  scenarioDefinitionByResultId={scenarioDefinitionByResultId}
                  activeConfig={activeConfig}
                  libraryScenarios={libraryScenarios}
                  id={id}
                  toggle={toggle}
                  runSectionKey={runSectionKey}
                  toggleRunSection={toggleRunSection}
                  isRunSectionOpen={isRunSectionOpen}
                  openAssistantWithPrompt={openAssistantWithPrompt}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {assistantOpen && (
          <div className="min-w-0 space-y-0 xl:flex xl:h-full xl:min-h-0 xl:flex-col">
            <Tabs
              value={contextPanelTab}
              onValueChange={(v) => setContextPanelTab(v as 'assistant' | 'reports' | 'note')}
              className="min-w-0 -mb-px px-3 pt-1"
            >
              <TabsList className="h-auto w-full justify-start rounded-none border-b bg-transparent p-0">
                <TabsTrigger
                  value="assistant"
                  className="-mb-px h-9 rounded-none rounded-t border border-border border-b-border bg-muted/20 px-3 text-xs text-muted-foreground data-[state=active]:z-10 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:border-border data-[state=active]:border-b-card data-[state=active]:shadow-none"
                >
                  Assistant
                </TabsTrigger>
                <TabsTrigger
                  value="reports"
                  className="-mb-px h-9 rounded-none rounded-t border border-border border-b-border bg-muted/20 px-3 text-xs text-muted-foreground data-[state=active]:z-10 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:border-border data-[state=active]:border-b-card data-[state=active]:shadow-none"
                >
                  Reports
                </TabsTrigger>
                <TabsTrigger
                  value="note"
                  className="-mb-px h-9 rounded-none rounded-t border border-border border-b-border bg-muted/20 px-3 text-xs text-muted-foreground data-[state=active]:z-10 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:border-border data-[state=active]:border-b-card data-[state=active]:shadow-none"
                >
                  Note
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {contextPanelTab === 'assistant' ? (
              <ResultAssistantPanel
                title="MCP Lab Assistant"
                description="Ask questions about this run result, failures, and tool usage."
                expanded={assistantExpanded}
                onToggleExpanded={() => setAssistantExpanded((prev) => !prev)}
                onHide={() => setAssistantOpen(false)}
                messages={assistantMessages}
                pendingToolCalls={assistantPendingToolCalls}
                loading={assistantLoading}
                onCancel={assistantTurnCancelable ? cancelAssistantTurn : undefined}
                input={assistantInput}
                onInputChange={setAssistantInput}
                onSend={() => void askResultAssistant()}
                inputPlaceholder="Ask about this result..."
                snippets={RESULT_ASSISTANT_SNIPPETS}
                onSnippetSelect={applyResultAssistantSnippet}
                onApproveToolCall={approveResultAssistantToolCall}
                onDenyToolCall={denyResultAssistantToolCall}
                expired={assistantExpired}
                inputRef={assistantInputRef}
                className="min-w-0 overflow-hidden rounded-t-none xl:flex xl:h-full xl:min-h-0 xl:flex-col"
                renderMessageFooter={(message) => {
                  if (message.role !== 'assistant') return null;
                  const canShowHandoff = isScenarioAssistantHandoffRelevant(
                    message.text,
                    Boolean(assistantContextScenarioId)
                  );
                  return (
                    <div className="mt-3 flex max-w-full flex-wrap justify-end gap-2 overflow-x-auto pb-1">
                      {canShowHandoff && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-xs"
                          onClick={() => sendToScenarioAssistant(message.text)}
                        >
                          <Sparkles className="h-4 w-4 text-amber-500" />
                          Send to Scenario Assistant
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-xs"
                        onClick={() => openApplyReportDialog(message.text)}
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        Apply: Write Markdown Report
                      </Button>
                    </div>
                  );
                }}
              />
            ) : contextPanelTab === 'reports' ? (
              <Card className="min-w-0 overflow-hidden rounded-t-none xl:flex xl:h-full xl:min-h-0 xl:flex-col">
                <CardHeader className="border-b px-4 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <NotepadText className="h-4 w-4 text-muted-foreground" />
                        Reports
                      </CardTitle>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => setAssistantExpanded((prev) => !prev)}
                        >
                          {assistantExpanded ? (
                            <PanelRightClose className="h-3.5 w-3.5" />
                          ) : (
                            <PanelRightOpen className="h-3.5 w-3.5" />
                          )}
                          {assistantExpanded ? 'Compact' : 'Expand'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setAssistantOpen(false)}
                        >
                          Hide
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Review markdown reports for this run while keeping the result visible.
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="flex h-[70vh] min-h-[520px] flex-col p-0 xl:h-auto xl:min-h-0 xl:flex-1">
                  {(referenceReportsLoading ||
                    referenceReports.length === 0 ||
                    referenceReports.length > 1) && (
                    <div className="border-b px-4 py-3">
                      {referenceReportsLoading ? (
                        <p className="text-xs text-muted-foreground">
                          Loading reference reports...
                        </p>
                      ) : referenceReports.length === 0 ? (
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm text-muted-foreground">
                            No reference reports for this run yet.
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0 gap-1.5"
                            onClick={() => openManualReportDialog()}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            New Report
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {referenceReports.length > 1 ? (
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">
                                Selected report
                              </p>
                              <Select
                                value={selectedReferenceReportPath}
                                onValueChange={setSelectedReferenceReportPath}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue placeholder="Select a report" />
                                </SelectTrigger>
                                <SelectContent>
                                  {referenceReports.map((report) => (
                                    <SelectItem key={report.path} value={report.relativePath}>
                                      {report.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}
                  <ScrollArea className="min-h-0 flex-1 bg-muted/15 px-4 py-4">
                    {referenceReports.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No report selected.</div>
                    ) : selectedReferenceReportLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading report...
                      </div>
                    ) : selectedReferenceReportError ? (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        Could not load report: {selectedReferenceReportError}
                      </div>
                    ) : selectedReferenceReport ? (
                      <div className="space-y-3">
                        <div className="rounded-md border bg-background p-3">
                          <p className="font-mono text-xs font-semibold">
                            {selectedReferenceReport.name}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {selectedReferenceReport.relativePath}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {new Date(selectedReferenceReport.mtime).toLocaleString()}
                          </p>
                        </div>
                        <div className="rounded-md border bg-background p-3">
                          <MarkdownContent
                            text={selectedReferenceReport.content}
                            className="text-sm"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Select a report to preview.
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            ) : (
              <Card className="min-w-0 overflow-hidden rounded-t-none xl:flex xl:h-full xl:min-h-0 xl:flex-col">
                <CardHeader className="border-b px-4 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <NotepadText className="h-4 w-4 text-muted-foreground" />
                        Run Note
                      </CardTitle>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => setAssistantExpanded((prev) => !prev)}
                        >
                          {assistantExpanded ? (
                            <PanelRightClose className="h-3.5 w-3.5" />
                          ) : (
                            <PanelRightOpen className="h-3.5 w-3.5" />
                          )}
                          {assistantExpanded ? 'Compact' : 'Expand'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setAssistantOpen(false)}
                        >
                          Hide
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Add context for this run, such as server version or environment details.
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="flex h-[70vh] min-h-[520px] flex-col p-4 xl:h-auto xl:min-h-0 xl:flex-1">
                  {editingRunNote ? (
                    <div className="w-full max-w-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium">Run note</p>
                        <span className="text-xs text-muted-foreground">
                          {runNoteDraft.length}/500
                        </span>
                      </div>
                      <Textarea
                        value={runNoteDraft}
                        onChange={(e) => setRunNoteDraft(e.target.value.slice(0, 500))}
                        placeholder="Optional context for this run"
                        rows={3}
                        className="min-h-20 resize"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => void saveRunNote()}
                          disabled={savingRunNote}
                        >
                          {savingRunNote ? 'Saving...' : 'Save note'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRunNoteDraft(result.runNote ?? '');
                            setEditingRunNote(false);
                          }}
                          disabled={savingRunNote}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full max-w-3xl items-center gap-2 rounded-md border bg-muted/20 px-2 py-1 text-xs">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="text-muted-foreground">Run note:</span>
                        <span
                          className={`wrap-break-word ${
                            result.runNote ? 'text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          {result.runNote || 'none'}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-6 px-2 text-xs"
                        onClick={() => setEditingRunNote(true)}
                      >
                        {result.runNote ? 'Edit' : 'Add note'}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
        <AlertDialog
          open={applyReportOpen}
          onOpenChange={(open) => !applyReportPending && setApplyReportOpen(open)}
        >
          <AlertDialogContent className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {applyReportIsManual
                  ? 'Create markdown report'
                  : 'Approve MCP action: write markdown report'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {applyReportIsManual ? (
                  'Write a custom markdown report and save it to the workspace.'
                ) : (
                  <>
                    This will call <code>mcplab_write_markdown_report</code> via the local MCPLab
                    MCP server.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              {!applyReportIsManual && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Output path</p>
                  <Input
                    value={applyReportOutputPath}
                    onChange={(e) => setApplyReportOutputPath(e.target.value)}
                    placeholder="mcplab/reports/result-assistant/my-report.md"
                    disabled={applyReportPending}
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={applyReportOverwrite}
                  onCheckedChange={(v) => setApplyReportOverwrite(v === true)}
                  disabled={applyReportPending}
                />
                <span>Overwrite if file exists</span>
              </label>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {applyReportIsManual ? 'Markdown content' : 'Markdown preview (to be written)'}
                </p>
                <Textarea
                  value={applyReportMarkdown}
                  onChange={(e) => setApplyReportMarkdown(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                  disabled={applyReportPending}
                />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={applyReportPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void applyAssistantReport();
                }}
                disabled={applyReportPending}
              >
                {applyReportPending
                  ? 'Writing...'
                  : applyReportIsManual
                    ? 'Save Report'
                    : 'Approve & Write'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={deleteRunOpen} onOpenChange={setDeleteRunOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete run?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove run <span className="font-mono">{result?.id}</span>.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingRun}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deletingRun || !result?.id}
                onClick={(e) => {
                  e.preventDefault();
                  void deleteRun();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deletingRun ? 'Deleting...' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default ResultDetail;
