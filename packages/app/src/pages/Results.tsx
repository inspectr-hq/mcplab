import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clock,
  MoreHorizontal,
  Eye,
  Download,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Plus,
  BarChart3,
  Sparkles,
  Bot,
  User,
  Wrench,
  Loader2,
  Send,
  PanelRightOpen,
  PanelRightClose
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { PassRateBadge } from "@/components/PassRateBadge";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { EvalResult } from "@/types/eval";
import type {
  ResultAssistantPendingToolCall,
  ResultAssistantSessionView,
  ResultAssistantTurnResponse
} from "@/lib/data-sources/types";

type RunScopeSummary = {
  scenarioCount: number;
  agentCount: number;
  scenarioPreview: string;
};

type ResultAssistantTurnPayload = {
  session: ResultAssistantSessionView;
  response: ResultAssistantTurnResponse;
};

function runScopeSummary(run: EvalResult): RunScopeSummary {
  const scenarioLabels = Array.from(
    new Map(
      run.scenarios
        .map((scenario) => {
          const id = String(scenario.scenarioId ?? "").trim();
          const name = String(scenario.scenarioName ?? "").trim();
          if (!id && !name) return null;
          return [id || name, name || id] as const;
        })
        .filter((entry): entry is readonly [string, string] => Boolean(entry))
    ).values()
  );
  const agentNames = Array.from(new Set(run.scenarios.map((scenario) => scenario.agentName).filter(Boolean)));
  const scenarioPreview = scenarioLabels.slice(0, 2).join(", ");
  const scenarioRemainder = scenarioLabels.length > 2 ? ` +${scenarioLabels.length - 2}` : "";
  return {
    scenarioCount: scenarioLabels.length,
    agentCount: agentNames.length,
    scenarioPreview: scenarioPreview ? `${scenarioPreview}${scenarioRemainder}` : "n/a"
  };
}

const Results = () => {
  const { source } = useDataSource();
  const [results, setResults] = useState<EvalResult[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDeleteRunId, setPendingDeleteRunId] = useState<string | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [sortBy, setSortBy] = useState<"id" | "timestamp" | "passRate" | "scenarios" | "avgToolCalls" | "toolTokens">("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [scenarioFilter, setScenarioFilter] = useState("all");
  const [openScenarioFilterPicker, setOpenScenarioFilterPicker] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantSessionId, setAssistantSessionId] = useState<string | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<ResultAssistantSessionView["messages"]>([]);
  const [assistantPendingToolCalls, setAssistantPendingToolCalls] = useState<ResultAssistantPendingToolCall[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const assistantChatEndRef = useRef<HTMLDivElement | null>(null);
  const assistantInputRef = useRef<HTMLTextAreaElement | null>(null);
  const RESULT_ASSISTANT_SNIPPETS = [
    {
      label: "Summarize Run Trends",
      description: "Highlight the main changes across the selected runs.",
      prompt:
        "Summarize the main trends across these runs. Call out pass-rate changes, latency, and tool usage shifts."
    },
    {
      label: "Explain Failures",
      description: "Identify the most important failures and likely root causes.",
      prompt:
        "Identify the most important failures across these runs and explain likely root causes from the traces."
    },
    {
      label: "Compare Agents",
      description: "Compare agent behavior, tool use, and answer quality across runs.",
      prompt:
        "Compare agent behavior across these runs. Highlight differences in tool use, answer quality, and consistency."
    },
    {
      label: "Spot Anomalies",
      description: "Find outliers in latency, tool calls, or pass rate.",
      prompt:
        "Find unusual runs or outliers in latency, tool calls, or pass rate, and explain why they stand out."
    }
  ] as const;

  const toggleSort = (next: typeof sortBy) => {
    if (sortBy === next) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(next);
    setSortDir(next === "timestamp" ? "desc" : "asc");
  };

  const loadResults = async () => {
    setRefreshing(true);
    try {
      setResults(await source.listResults());
    } catch (error: unknown) {
      toast({
        title: "Could not load results",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive"
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
          title: "Could not load results",
          description: (error instanceof Error ? error.message : String(error)),
          variant: "destructive"
        });
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [source]);

  useEffect(() => {
    if (!assistantOpen) return;
    const t = window.setTimeout(() => {
      const chatEnd = assistantChatEndRef.current;
      if (chatEnd && typeof chatEnd.scrollIntoView === "function") {
        chatEnd.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [assistantOpen, assistantMessages.length, assistantLoading]);

  useEffect(() => {
    const el = assistantInputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(40, next)}px`;
  }, [assistantInput, assistantOpen]);

  useEffect(() => {
    return () => {
      if (!assistantSessionId) return;
      void source.closeResultAssistantSession(assistantSessionId).catch(() => undefined);
    };
  }, [assistantSessionId, source]);

  const scenarioFilterOptions = useMemo(() => {
    const labels = new Set<string>();
    results.forEach((run) => {
      run.scenarios.forEach((scenario) => {
        const scenarioName = String(scenario.scenarioName ?? "").trim();
        const scenarioId = String(scenario.scenarioId ?? "").trim();
        const label = scenarioName || scenarioId;
        if (label) labels.add(label);
      });
    });
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [results]);

  const filteredResults = useMemo(() => {
    if (scenarioFilter === "all") return results;
    return results.filter((run) =>
      run.scenarios.some((scenario) => {
        const scenarioName = String(scenario.scenarioName ?? "").trim();
        const scenarioId = String(scenario.scenarioId ?? "").trim();
        const label = scenarioName || scenarioId;
        return label === scenarioFilter;
      })
    );
  }, [results, scenarioFilter]);

  const sorted = useMemo(() => {
    const compareNullableNumbers = (left: number | null, right: number | null) => {
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return sortDir === "asc" ? left - right : right - left;
    };
    const next = [...filteredResults].sort((a, b) => {
      if (sortBy === "toolTokens") {
        return compareNullableNumbers(a.toolTokenUsage?.totalTokens ?? null, b.toolTokenUsage?.totalTokens ?? null);
      }
      let cmp = 0;
      if (sortBy === "id") cmp = a.id.localeCompare(b.id);
      if (sortBy === "timestamp") cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sortBy === "passRate") cmp = a.overallPassRate - b.overallPassRate;
      if (sortBy === "scenarios") cmp = a.totalScenarios - b.totalScenarios;
      if (sortBy === "avgToolCalls") cmp = a.avgToolCalls - b.avgToolCalls;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return next;
  }, [filteredResults, sortBy, sortDir]);

  const sortIcon = (key: typeof sortBy) => {
    if (sortBy !== key) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  const formatToolTokenTotal = (result: EvalResult) => {
    const total = result.toolTokenUsage?.totalTokens;
    return typeof total === "number" ? total.toLocaleString() : "n/a";
  };

  const runScopesById = useMemo(() => {
    const map = new Map<string, RunScopeSummary>();
    for (const run of sorted) {
      map.set(run.id, runScopeSummary(run));
    }
    return map;
  }, [sorted]);

  const syncResultAssistantSession = (session: ResultAssistantSessionView) => {
    setAssistantSessionId(session.id);
    setAssistantMessages(session.messages);
    setAssistantPendingToolCalls(session.pendingToolCalls);
  };

  const syncAndContinueAssistantTurn = async (sessionId: string, payload: ResultAssistantTurnPayload) => {
    let current = payload;
    syncResultAssistantSession(current.session);
    for (let i = 0; i < 25 && current.response.autoContinue; i += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      current = await source.continueResultAssistantSession(sessionId);
      syncResultAssistantSession(current.session);
    }
  };

  const openGlobalAssistant = () => {
    setAssistantOpen(true);
    setAssistantMessages((prev) => {
      if (prev.length > 0) return prev;
      return [
        {
          id: `msg-${Date.now()}`,
          role: "assistant",
          text: "Ask me to compare runs, explain regressions over time, or summarize historical drift patterns.",
          createdAt: new Date().toISOString()
        }
      ];
    });
  };

  const applyResultAssistantSnippet = (snippet: string) => {
    setAssistantOpen(true);
    setAssistantInput(snippet);
    requestAnimationFrame(() => assistantInputRef.current?.focus());
  };

  const askAssistant = async () => {
    const question = assistantInput.trim();
    if (!question) return;
    const optimisticMessageId = `msg-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMessage = {
      id: optimisticMessageId,
      role: "user" as const,
      text: question,
      createdAt: new Date().toISOString()
    };
    setAssistantInput("");
    setAssistantMessages((prev) => [...prev, optimisticMessage]);
    setAssistantLoading(true);
    try {
      let sessionId = assistantSessionId;
      if (!sessionId) {
        const created = await source.createResultAssistantSession({ scope: "all_runs" });
        sessionId = created.sessionId;
        setAssistantSessionId(created.session.id);
        setAssistantPendingToolCalls(created.session.pendingToolCalls);
        setAssistantMessages((prev) => {
          const optimisticStillPresent = prev.some((m) => m.id === optimisticMessageId);
          if (!optimisticStillPresent) return created.session.messages;
          return [...created.session.messages, optimisticMessage];
        });
      }
      const response = await source.sendResultAssistantMessage(sessionId, question);
      await syncAndContinueAssistantTurn(sessionId, response);
    } catch (error: unknown) {
      setAssistantMessages((prev) => prev.filter((m) => m.id !== optimisticMessageId));
      toast({
        title: "MCP Lab Assistant error",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive"
      });
    } finally {
      setAssistantLoading(false);
    }
  };

  const approveResultAssistantToolCall = async (callId: string) => {
    if (!assistantSessionId) return;
    setAssistantLoading(true);
    try {
      const response = await source.approveResultAssistantToolCall(assistantSessionId, callId);
      await syncAndContinueAssistantTurn(assistantSessionId, response);
    } catch (error: unknown) {
      toast({
        title: "Could not approve assistant action",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive"
      });
    } finally {
      setAssistantLoading(false);
    }
  };

  const denyResultAssistantToolCall = async (callId: string) => {
    if (!assistantSessionId) return;
    setAssistantLoading(true);
    try {
      const response = await source.denyResultAssistantToolCall(assistantSessionId, callId);
      await syncAndContinueAssistantTurn(assistantSessionId, response);
    } catch (error: unknown) {
      toast({
        title: "Could not deny assistant action",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive"
      });
    } finally {
      setAssistantLoading(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    setDeletingRun(true);
    try {
      await source.deleteResult(runId);
      setResults((prev) => prev.filter((r) => r.id !== runId));
      toast({ title: "Run deleted", description: runId });
      setPendingDeleteRunId(null);
    } catch (error: unknown) {
      toast({
        title: "Could not delete run",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive"
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
              This will permanently remove the run artifacts from disk for{" "}
              <span className="font-mono">{pendingDeleteRunId ?? ""}</span>.
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
              {deletingRun ? "Deleting..." : "Delete run"}
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
          <p className="text-sm text-muted-foreground">Browse evaluation runs and open detailed results</p>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={openScenarioFilterPicker} onOpenChange={setOpenScenarioFilterPicker}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={openScenarioFilterPicker}
                className="w-[260px] justify-between font-normal"
              >
                <span className="truncate text-left">
                  {scenarioFilter === "all" ? "All scenarios" : scenarioFilter}
                </span>
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
                        setScenarioFilter("all");
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
          <Button variant="outline" onClick={() => void loadResults()} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
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
              ? "xl:grid-cols-[minmax(0,1fr)_52rem]"
              : "xl:grid-cols-[minmax(0,1fr)_30rem]"
            : "grid-cols-1"
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
                      onClick={() => toggleSort("id")}
                    >
                      Run ID
                      {sortIcon("id")}
                    </button>
                  </TableHead>
                  <TableHead>Evaluated</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("timestamp")}
                    >
                      Timestamp
                      {sortIcon("timestamp")}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("passRate")}
                    >
                      Pass Rate
                      {sortIcon("passRate")}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("scenarios")}
                    >
                      Scenarios
                      {sortIcon("scenarios")}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("avgToolCalls")}
                    >
                      Avg Tool Calls
                      {sortIcon("avgToolCalls")}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("toolTokens")}
                    >
                      Tool Tokens
                      {sortIcon("toolTokens")}
                    </button>
                  </TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <Link to={`/results/${r.id}`} className="font-mono text-xs text-primary hover:underline">
                          {r.id}
                        </Link>
                        {r.configId ? <div className="text-[11px] text-muted-foreground">{r.configId}</div> : null}
                        {r.runNote ? (
                          <div className="text-[11px] text-muted-foreground break-words">Note: {r.runNote}</div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {(() => {
                        const scope = runScopesById.get(r.id)!;
                        return (
                          <div className="space-y-0.5">
                            <div>
                              Evaluated: {scope.scenarioCount} scenario{scope.scenarioCount === 1 ? "" : "s"} ·{" "}
                              {scope.agentCount} agent{scope.agentCount === 1 ? "" : "s"}
                            </div>
                            <div className="font-mono text-xs text-foreground/80">{scope.scenarioPreview}</div>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(r.timestamp).toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <PassRateBadge rate={r.overallPassRate} />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{r.totalScenarios}</TableCell>
                    <TableCell className="font-mono text-sm">{r.avgToolCalls.toFixed(0)}</TableCell>
                    <TableCell className="font-mono text-sm">{formatToolTokenTotal(r)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/results/${r.id}`}>
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
                              setPendingDeleteRunId(r.id);
                            }}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {assistantOpen && (
          <Card className="min-w-0 overflow-hidden xl:flex xl:h-[calc(100vh-14rem)] xl:min-h-0 xl:flex-col">
            <CardHeader className="border-b px-4 py-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    MCP Lab Assistant
                  </CardTitle>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => setAssistantExpanded((prev) => !prev)}
                    >
                      {assistantExpanded ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
                      {assistantExpanded ? "Compact" : "Expand"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setAssistantOpen(false)}>
                      Hide
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Analyze historical differences and trends across all result runs.
                </p>
              </div>
            </CardHeader>
            <CardContent className="flex h-[70vh] min-h-[520px] flex-col p-0 xl:h-auto xl:min-h-0 xl:flex-1">
              <div className="min-h-0 flex-1 overflow-y-auto bg-muted/15 px-4 py-4">
                <div className="space-y-3 pr-2">
                  {assistantMessages.map((message, index) => {
                    const isUser = message.role === "user";
                    const isAssistant = message.role === "assistant";
                    const linkedPendingToolCall = message.pendingToolCallId
                      ? assistantPendingToolCalls.find((call) => call.id === message.pendingToolCallId)
                      : undefined;
                    const isAssistantToolRequest = isAssistant && Boolean(message.pendingToolCallId);
                    if (isAssistantToolRequest) {
                      return (
                        <div key={`${message.id ?? `${message.role}-${index}`}-tool`} className="rounded-md border bg-background p-3">
                          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Wrench className="h-3.5 w-3.5" />
                            {linkedPendingToolCall?.tool ?? message.toolRequestName ?? "tool call"}
                          </div>
                          <MarkdownContent text={message.text} className="text-sm" />
                          {linkedPendingToolCall && (
                            <div className="mt-3 flex justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                disabled={assistantLoading}
                                onClick={() => void denyResultAssistantToolCall(linkedPendingToolCall.id)}
                              >
                                Deny
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={assistantLoading}
                                onClick={() => void approveResultAssistantToolCall(linkedPendingToolCall.id)}
                              >
                                Approve
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div key={message.id ?? `${message.role}-${index}`} className={`flex items-start gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
                        {!isUser && (
                          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                            <Bot className="h-3 w-3" />
                          </div>
                        )}
                        <div
                          className={`min-w-0 max-w-[92%] break-words rounded-md border p-3 text-sm ${
                            isUser ? "border-primary/20 bg-primary/10" : "border-border/80 bg-background shadow-sm"
                          }`}
                        >
                          <MarkdownContent text={message.text} className="text-sm" />
                        </div>
                        {isUser && (
                          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                            <User className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {assistantLoading && (
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                        <Bot className="h-3 w-3" />
                      </div>
                      <div className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Thinking...
                      </div>
                    </div>
                  )}
                  <div ref={assistantChatEndRef} />
                </div>
              </div>
              <div className="border-t bg-background px-4 py-3">
                <div className="rounded-xl border bg-background p-2 shadow-sm">
                  <Textarea
                    ref={assistantInputRef}
                    value={assistantInput}
                    onChange={(e) => setAssistantInput(e.target.value)}
                    placeholder="Ask about historical run differences..."
                    rows={1}
                    className="min-h-10 max-h-40 resize-none border-0 bg-transparent px-2 py-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!assistantLoading) void askAssistant();
                      }
                    }}
                  />
                <div className="mt-1 flex items-center justify-between gap-2 px-1 pt-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground/80 hover:text-muted-foreground"
                        disabled={assistantLoading}
                      >
                        <Plus className="h-3 w-3" />
                        Snippets
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[360px]">
                      <DropdownMenuLabel>Result Assistant Snippets</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {RESULT_ASSISTANT_SNIPPETS.map((snippet) => (
                        <DropdownMenuItem
                          key={snippet.label}
                          className="items-start whitespace-normal px-2 py-2"
                          onSelect={() => applyResultAssistantSnippet(snippet.prompt)}
                        >
                          <div className="space-y-0.5">
                            <div className="text-xs font-medium leading-tight">{snippet.label}</div>
                            <div className="text-[11px] leading-snug text-muted-foreground">
                              {snippet.description}
                            </div>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    size="icon"
                      className="h-8 w-8 shrink-0 rounded-full"
                      onClick={() => void askAssistant()}
                      disabled={assistantLoading || !assistantInput.trim()}
                      aria-label="Send assistant message"
                      title="Send assistant message"
                    >
                      {assistantLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Results;
