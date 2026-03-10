import { useState, useEffect, useRef, useMemo } from "react";
import { Play, Square, CheckCircle2, RefreshCw, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Link, useSearchParams } from "react-router-dom";
import { useConfigs } from "@/contexts/ConfigContext";
import { useDataSource } from "@/contexts/DataSourceContext";
import { useLibraries } from "@/contexts/LibraryContext";
import { toast } from "@/hooks/use-toast";
import { isUiFeatureEnabled } from "@/lib/feature-flags";
import type { QueueEntry } from "@/lib/data-sources/types";

const RUN_EVAL_ACTIVE_JOB_KEY = "mcplab.runEvaluation.activeJobId";

const RunEvaluation = () => {
  const [searchParams] = useSearchParams();
  const [configId, setConfigId] = useState("");
  const [varianceRuns, setVarianceRuns] = useState("1");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [runId, setRunId] = useState<string>("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [applySnapshotEval, setApplySnapshotEval] = useState(true);
  const [runNote, setRunNote] = useState("");
  const [snapshotName, setSnapshotName] = useState("");
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [queuedJobs, setQueuedJobs] = useState<QueueEntry[]>([]);
  const [activeQueueEntry, setActiveQueueEntry] = useState<QueueEntry | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const { configs, reload } = useConfigs();
  const { source } = useDataSource();
  const snapshotsUiEnabled = isUiFeatureEnabled("snapshots", false);
  const { agents: libraryAgents, scenarios: libraryScenarios, reload: reloadLibraries } = useLibraries();
  const selectedConfig = configs.find((item) => item.id === configId);
  const requestedConfigId = searchParams.get("configId");
  const availableAgents = useMemo(() => {
    if (!selectedConfig) return [];
    const byName = new Map<string, (typeof selectedConfig.agents)[number]>();
    const entries =
      selectedConfig.agentEntries && selectedConfig.agentEntries.length > 0
        ? selectedConfig.agentEntries
        : selectedConfig.agents.map((agent) => ({ kind: "inline" as const, agent }));
    for (const entry of entries) {
      if (entry.kind === "inline") {
        const key = entry.agent.id;
        if (!byName.has(key)) byName.set(key, entry.agent);
        continue;
      }
      const fromLibrary = libraryAgents.find((agent) => agent.id === entry.ref);
      if (fromLibrary && !byName.has(fromLibrary.id)) {
        byName.set(fromLibrary.id, fromLibrary);
      }
    }
    return Array.from(byName.values());
  }, [selectedConfig, libraryAgents]);
  const availableScenarios = useMemo(() => {
    if (!selectedConfig) return [];
    const byId = new Map<string, (typeof selectedConfig.scenarios)[number]>();
    const entries =
      selectedConfig.scenarioEntries && selectedConfig.scenarioEntries.length > 0
        ? selectedConfig.scenarioEntries
        : selectedConfig.scenarios.map((scenario) => ({ kind: "inline" as const, scenario }));
    for (const entry of entries) {
      if (entry.kind === "inline") {
        if (!byId.has(entry.scenario.id)) byId.set(entry.scenario.id, entry.scenario);
        continue;
      }
      const fromLibrary = libraryScenarios.find((scenario) => scenario.id === entry.ref);
      if (fromLibrary && !byId.has(fromLibrary.id)) byId.set(fromLibrary.id, fromLibrary);
    }
    return Array.from(byId.values());
  }, [selectedConfig, libraryScenarios]);
  useEffect(() => {
    if (!requestedConfigId) return;
    if (!configs.some((config) => config.id === requestedConfigId)) return;
    setConfigId(requestedConfigId);
  }, [requestedConfigId, configs]);

  const prevConfigKeyRef = useRef("");
  useEffect(() => {
    const configKey = selectedConfig ? `${selectedConfig.id}::${selectedConfig.sourcePath ?? ""}` : "";
    if (configKey === prevConfigKeyRef.current) return;
    prevConfigKeyRef.current = configKey;
    if (!selectedConfig) {
      setSelectedAgentIds([]);
      setSelectedScenarioIds([]);
      return;
    }
    const configuredDefaultAgentIds = availableAgents
      .filter((agent) =>
        (selectedConfig.runDefaults?.selectedAgentNames ?? []).includes(agent.id)
      )
      .map((agent) => agent.id);
    setSelectedAgentIds(
      configuredDefaultAgentIds.length > 0
        ? configuredDefaultAgentIds
        : availableAgents.map((agent) => agent.id)
    );
    setSelectedScenarioIds(availableScenarios.map((scenario) => scenario.id));
    setApplySnapshotEval(true);
  }, [selectedConfig?.id, selectedConfig?.sourcePath, availableAgents, availableScenarios]);

  const startWorkspaceRun = async () => {
    if (!selectedConfig?.sourcePath) {
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Missing source path for selected config.`]);
      return;
    }
    const selectedAgents = availableAgents.filter((agent) => selectedAgentIds.includes(agent.id));
    if (selectedAgents.length === 0) {
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Select at least one agent.`]);
      return;
    }
    const selectedScenarios = availableScenarios.filter((scenario) => selectedScenarioIds.includes(scenario.id));
    if (selectedScenarios.length === 0) {
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Select at least one test.`]);
      return;
    }
    setRunning(true);
    setDone(false);
    setStopped(false);
    setRunId("");
    const compositionMode =
      (selectedConfig.serverEntries ?? []).some((entry) => entry.kind === "referenced") ||
      (selectedConfig.agentEntries ?? []).some((entry) => entry.kind === "referenced") ||
      (selectedConfig.scenarioEntries ?? []).some((entry) => entry.kind === "referenced")
        ? "refs-composed"
        : "single-file/inline";
    setLogs([
      `[${new Date().toLocaleTimeString()}] Starting evaluation run...`,
      `[${new Date().toLocaleTimeString()}] Config=${selectedConfig.name} mode=${compositionMode} agents=${selectedAgents.map((a) => a.name || a.id).join(", ")} tests=${selectedScenarios.map((s) => s.id).join(", ")} runs=${Number(varianceRuns)} snapshotEval=${snapshotsUiEnabled && applySnapshotEval ? "on" : "off"}${runNote.trim() ? ` note=${runNote.trim()}` : ""}`
    ]);
    setProgress(10);
    try {
      const { jobId } = await source.startRun({
        configPath: selectedConfig.sourcePath,
        runsPerScenario: Number(varianceRuns),
        agents: selectedAgents.map((agent) => agent.id),
        scenarioIds: selectedScenarios.map((scenario) => scenario.id),
        applySnapshotEval: snapshotsUiEnabled ? applySnapshotEval : false,
        runNote: runNote.trim() ? runNote.trim() : undefined,
      });
      setActiveJobId(jobId);
      setActiveRunJob(jobId);
      attachRunJob(jobId);
      void refreshQueue();
    } catch (error: unknown) {
      const message = (error instanceof Error ? error.message : String(error));
      const extraHint = message.includes("Anthropic model not found")
        ? " Hint: this usually means the API key works but the model ID is not enabled for that Anthropic account. Change the agent model in Manage Agents (library) or inline config."
        : "";
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Error: ${message}${extraHint}`]);
      setRunning(false);
      setProgress(0);
      setActiveJobId(null);
    }
  };

  const startRun = () => {
    void startWorkspaceRun();
  };

  const stopRun = () => {
    if (activeJobId) {
      void source.stopRun(activeJobId);
    }
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    clearActiveRunJob();
    setActiveJobId(null);
    setRunning(false);
    setDone(false);
    setStopped(true);
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Run aborted by user.`]);
    void refreshQueue();
  };

  const saveSnapshot = async () => {
    if (!runId) return;
    setSavingSnapshot(true);
    try {
      const record = await source.createSnapshotFromRun(runId, snapshotName.trim() || undefined);
      toast({
        title: "Snapshot saved",
        description: `Created ${record.name} (${record.id})`,
      });
      if (!snapshotName.trim()) {
        setSnapshotName(record.name);
      }
    } catch (error: unknown) {
      toast({
        title: "Could not save snapshot",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    } finally {
      setSavingSnapshot(false);
    }
  };

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => () => {
    unsubscribeRef.current?.();
  }, []);

  useEffect(() => {
    if (activeJobId || done) return;
    let storedJobId = "";
    try {
      storedJobId = sessionStorage.getItem(RUN_EVAL_ACTIVE_JOB_KEY) ?? "";
    } catch {
      storedJobId = "";
    }
    if (!storedJobId) return;
    setActiveJobId(storedJobId);
    setRunning(true);
    setDone(false);
    setStopped(false);
    setLogs((prev) =>
      prev.length > 0
        ? prev
        : [`[${new Date().toLocaleTimeString()}] Reattached to in-progress evaluation run...`]
    );
    attachRunJob(storedJobId);
    return () => {
      // no-op; cleanup handled by existing unmount and attach replacement
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId, done]);

  const clearActiveRunJob = () => {
    try {
      sessionStorage.removeItem(RUN_EVAL_ACTIVE_JOB_KEY);
    } catch {
      // ignore storage access issues
    }
  };

  const setActiveRunJob = (jobId: string) => {
    try {
      sessionStorage.setItem(RUN_EVAL_ACTIVE_JOB_KEY, jobId);
    } catch {
      // ignore storage access issues
    }
  };

  const refreshQueue = async () => {
    try {
      const q = await source.getRunQueue();
      setQueuedJobs(q.queued);
      setActiveQueueEntry(q.active);
    } catch {
      // ignore fetch errors
    }
  };

  const refreshConfigAndLibraries = () => {
    void reload();
    void reloadLibraries();
  };

  useEffect(() => {
    refreshConfigAndLibraries();
    void refreshQueue();
    const handleFocus = () => {
      refreshConfigAndLibraries();
      void refreshQueue();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, reloadLibraries]);

  const removeQueuedJob = async (jobId: string) => {
    try {
      await source.removeQueuedRun(jobId);
      setQueuedJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      // Job may have auto-advanced to running — stop it instead
      if (msg.includes("Use the /stop endpoint")) {
        try {
          await source.stopRun(jobId);
        } catch {
          // ignore
        }
      } else {
        toast({
          title: "Could not remove queued run",
          description: msg,
          variant: "destructive",
        });
      }
    }
    void refreshQueue();
  };

  const attachRunJob = (jobId: string) => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = source.subscribeRunJob(jobId, (event) => {
      const ts = new Date(event.ts).toLocaleTimeString();
      if (event.type === "queued") {
        setLogs((prev) => {
          const position = event.payload.position ? ` (position ${event.payload.position})` : "";
          const line = `[${ts}] Run queued${position}. Waiting for active run to finish...`;
          return prev.includes(line) ? prev : [...prev, line];
        });
        setProgress(5);
        return;
      }
      if (event.type === "started") {
        setLogs((prev) => {
          const line = `[${ts}] Run started.`;
          return prev.includes(line) ? prev : [...prev, line];
        });
        setProgress((prev) => Math.max(prev, 30));
        setStopped(false);
      }
      if (event.type === "log") {
        const message = String(event.payload.message ?? "").trim();
        if (message) {
          setLogs((prev) => {
            const line = `[${ts}] ${message}`;
            return prev.includes(line) ? prev : [...prev, line];
          });
          setProgress((prev) => {
            const lower = message.toLowerCase();
            if (lower.startsWith("loading mcp evaluation config")) return Math.max(prev, 15);
            if (lower.startsWith("loaded config")) return Math.max(prev, 20);
            if (lower.startsWith("selected ")) return Math.max(prev, 30);
            if (lower.startsWith("using requested agents") || lower.startsWith("using resolved default agents")) return Math.max(prev, 35);
            if (lower.startsWith("expanded to ")) return Math.max(prev, 45);
            if (lower.startsWith("running evaluation")) return Math.max(prev, 50);
            // "Scenario 3/6 finished:" → interpolate between 50% and 75%
            const scenarioMatch = lower.match(/^scenario (\d+)\/(\d+) finished:/);
            if (scenarioMatch) {
              const current = Number(scenarioMatch[1]);
              const total = Number(scenarioMatch[2]);
              return Math.max(prev, 50 + Math.round((current / total) * 25));
            }
            if (lower.startsWith("evaluation execution finished")) return Math.max(prev, 78);
            if (lower.startsWith("applying snapshot evaluation policy")) return Math.max(prev, 82);
            if (lower.includes("snapshot evaluation applied") || lower.includes("snapshot evaluation enabled")) return Math.max(prev, 88);
            if (lower.startsWith("writing results to ")) return Math.max(prev, 94);
            if (lower.startsWith("run finished:")) return Math.max(prev, 98);
            return prev;
          });
        }
      }
      if (event.type === "completed") {
        const nextRunId = String(event.payload.runId ?? "");
        setLogs((prev) => {
          const line = `[${ts}] Run completed.`;
          return prev.includes(line) ? prev : [...prev, line];
        });
        if (event.payload.snapshotEval && typeof event.payload.snapshotEval === "object") {
          const snapshotEval = event.payload.snapshotEval as {
            mode?: string;
            baseline_snapshot_id?: string;
            overall_score?: number;
            status?: string;
          };
          setLogs((prev) => {
            const line = `[${ts}] Snapshot eval (${snapshotEval.mode ?? "warn"}) baseline=${snapshotEval.baseline_snapshot_id ?? "-"} score=${snapshotEval.overall_score ?? "-"} status=${snapshotEval.status ?? "-"}`;
            return prev.includes(line) ? prev : [...prev, line];
          });
        }
        setProgress(100);
        setRunning(false);
        setDone(true);
        setStopped(false);
        setRunId(nextRunId);
        clearActiveRunJob();
        setActiveJobId(null);
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        void refreshQueue();
      }
      if (event.type === "error") {
        const message = String(event.payload.message ?? "Unknown error");
        const extraHint = message.includes("Anthropic model not found")
          ? " Hint: this usually means the API key works but the model ID is not enabled for that Anthropic account. Change the agent model in Manage Agents (library) or inline config."
          : "";
        setLogs((prev) => [...prev, `[${ts}] Error: ${message}${extraHint}`]);
        setRunning(false);
        setDone(false);
        setStopped(false);
        setProgress(0);
        clearActiveRunJob();
        setActiveJobId(null);
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        void refreshQueue();
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
          <Play className="h-6 w-6" />
          Run Evaluation
        </h1>
        <p className="text-sm text-muted-foreground">Execute evaluation scenarios against MCP servers</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>MCP Evaluation</Label>
              <div className="flex items-center gap-2">
                <Select value={configId} onValueChange={setConfigId}>
                  <SelectTrigger><SelectValue placeholder="Select a config" /></SelectTrigger>
                  <SelectContent>
                    {configs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  onClick={refreshConfigAndLibraries}
                  aria-label="Refresh configs"
                  title="Refresh configs"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Variance Runs</Label>
              <Input type="number" min="1" max="10" value={varianceRuns} onChange={(e) => setVarianceRuns(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="run-note">Run Note</Label>
              <span className="text-xs text-muted-foreground">{runNote.length}/500</span>
            </div>
            <Textarea
              id="run-note"
              value={runNote}
              onChange={(e) => setRunNote(e.target.value.slice(0, 500))}
              placeholder="Optional context for this run (for example: mcp-server v1.8.2 #staging)"
              rows={2}
            />
          </div>
          {selectedConfig && (
            <div className="space-y-2">
              {snapshotsUiEnabled && selectedConfig.snapshotEval?.enabled && (
                <div className="rounded-md border bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                  Snapshot eval active ({selectedConfig.snapshotEval.mode}) · baseline:{" "}
                  <span className="font-mono">{selectedConfig.snapshotEval.baselineSnapshotId ?? "none"}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label>Agents</Label>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setSelectedAgentIds(availableAgents.map((agent) => agent.id))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setSelectedAgentIds([])}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableAgents.map((agent) => {
                  const checked = selectedAgentIds.includes(agent.id);
                  return (
                    <label key={agent.id} className="flex items-center gap-2 text-sm rounded-md border p-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => {
                          const isChecked = value === true;
                          setSelectedAgentIds((prev) =>
                            isChecked ? [...prev, agent.id] : prev.filter((id) => id !== agent.id),
                          );
                        }}
                      />
                      <span>{agent.name || agent.id}</span>
                    </label>
                  );
                })}
              </div>
              {availableAgents.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No agents available in this config. Add inline agents or agent references.
                </p>
              )}
            </div>
          )}
          {selectedConfig && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Tests</Label>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setSelectedScenarioIds(availableScenarios.map((scenario) => scenario.id))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setSelectedScenarioIds([])}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedScenarioIds.length} of {availableScenarios.length} selected
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableScenarios.map((scenario) => {
                  const checked = selectedScenarioIds.includes(scenario.id);
                  return (
                    <label key={scenario.id} className="flex items-start gap-2 text-sm rounded-md border p-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => {
                          const isChecked = value === true;
                          setSelectedScenarioIds((prev) =>
                            isChecked ? [...prev, scenario.id] : prev.filter((id) => id !== scenario.id),
                          );
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{scenario.name || scenario.id}</span>
                        <span className="block font-mono text-xs text-muted-foreground truncate">{scenario.id}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {snapshotsUiEnabled && (
          <label className="flex items-center gap-2 text-sm rounded-md border p-2">
            <Checkbox checked={applySnapshotEval} onCheckedChange={(v) => setApplySnapshotEval(v === true)} />
            <span>Apply snapshot evaluation policy (if configured)</span>
          </label>
          )}
          <div className="flex gap-2">
            <Button
              onClick={startRun}
              disabled={
                !configId ||
                (availableAgents.length > 0 && selectedAgentIds.length === 0) ||
                (availableScenarios.length > 0 && selectedScenarioIds.length === 0)
              }
            >
              <Play className="mr-2 h-4 w-4" />{activeQueueEntry ? "Queue Run" : "Run"}
            </Button>
            {running && (
              <Button variant="destructive" onClick={stopRun}>
                <Square className="mr-2 h-4 w-4" />Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {(running || logs.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Progress</CardTitle>
              <span className="text-xs text-muted-foreground font-mono">{Math.round(progress)}%</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={progress} className="h-2" />
            <div ref={logRef} className="h-64 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs space-y-0.5">
              {logs.map((log, i) => (
                <div key={i} className={log.includes("✓") ? "text-success" : log.includes("aborted") ? "text-destructive" : "text-foreground"}>
                  {log}
                </div>
              ))}
            </div>
          </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="inline-flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" />
              Run Queue
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => void refreshQueue()}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!activeQueueEntry && queuedJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active or queued runs. Start a run above.</p>
          ) : (
            <div className="space-y-2">
              {activeQueueEntry && (
                <div
                  className={`flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 p-2 text-sm cursor-pointer hover:bg-primary/10 transition-colors ${activeJobId === activeQueueEntry.jobId ? "ring-2 ring-primary/40" : ""}`}
                  onClick={() => {
                    if (activeJobId === activeQueueEntry.jobId) return;
                    setActiveJobId(activeQueueEntry.jobId);
                    setActiveRunJob(activeQueueEntry.jobId);
                    setRunning(true);
                    setDone(false);
                    setStopped(false);
                    setLogs([`[${new Date().toLocaleTimeString()}] Attached to running job ${activeQueueEntry.jobId}...`]);
                    setProgress(10);
                    attachRunJob(activeQueueEntry.jobId);
                  }}
                  title="Click to view progress"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Running</span>
                    <span className="font-mono text-xs">{activeQueueEntry.runParams.configPath.split("/").pop() ?? activeQueueEntry.runParams.configPath}</span>
                    {activeQueueEntry.runParams.agents && (
                      <span className="text-xs text-muted-foreground">
                        agents: {activeQueueEntry.runParams.agents.join(", ")}
                      </span>
                    )}
                    {activeQueueEntry.runParams.runNote && (
                      <span className="text-xs text-muted-foreground truncate">
                        note: {activeQueueEntry.runParams.runNote}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeQueueEntry) {
                        void source.stopRun(activeQueueEntry.jobId);
                        void refreshQueue();
                      }
                    }}
                    title="Stop running job"
                  >
                    <Square className="mr-1 h-3 w-3" />Stop
                  </Button>
                </div>
              )}
              {queuedJobs.map((entry, i) => {
                const configName = entry.runParams.configPath.split("/").pop() ?? entry.runParams.configPath;
                return (
                  <div key={entry.jobId} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">#{i + 1} Queued</span>
                      <span className="font-mono text-xs">{configName}</span>
                      {entry.runParams.agents && (
                        <span className="text-xs text-muted-foreground">
                          agents: {entry.runParams.agents.join(", ")}
                        </span>
                      )}
                      {entry.runParams.runNote && (
                        <span className="text-xs text-muted-foreground truncate">
                          note: {entry.runParams.runNote}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => void removeQueuedJob(entry.jobId)}
                      title="Remove from queue"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {stopped && !running && !done && (
        <Card className="border-amber-300/60 bg-amber-50/40">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <Square className="h-5 w-5 text-amber-700" />
              <div className="min-w-0">
                <p className="font-medium">Run stopped</p>
                <p className="text-sm text-muted-foreground">
                  The evaluation was stopped before completion. You can start it again or clear the progress log.
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => {
                  setLogs([]);
                  setProgress(0);
                  setStopped(false);
                }}>
                  Clear Progress
                </Button>
                <Button type="button" onClick={startRun} disabled={!configId}>
                  <Play className="mr-2 h-4 w-4" />Run Again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {done && (
        <Card className="border-success/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-success" />
              <div>
                <p className="font-medium">Evaluation Complete</p>
                <p className="text-sm text-muted-foreground">All scenarios have been evaluated successfully.</p>
              </div>
              <Button asChild className="ml-auto">
                <Link to={`/results/${runId}${configId ? `?configId=${encodeURIComponent(configId)}` : ""}`}>View Results</Link>
              </Button>
            </div>
            {snapshotsUiEnabled && runId && (
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Snapshot name (optional)</Label>
                  <Input
                    value={snapshotName}
                    onChange={(e) => setSnapshotName(e.target.value)}
                    placeholder="e.g. baseline-v1"
                    className="h-8 w-64"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void saveSnapshot()}
                  disabled={savingSnapshot}
                >
                  {savingSnapshot ? "Saving..." : "Save Snapshot"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default RunEvaluation;
