import { useState, useEffect, useRef, useMemo } from "react";
import { Play, Square, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Link, useSearchParams } from "react-router-dom";
import { useConfigs } from "@/contexts/ConfigContext";
import { useDataSource } from "@/contexts/DataSourceContext";
import { useLibraries } from "@/contexts/LibraryContext";
import { toast } from "@/hooks/use-toast";

const RUN_EVAL_ACTIVE_JOB_KEY = "mcplab.runEvaluation.activeJobId";

const logMessages = [
  "Initializing evaluation runner...",
  "Loading configuration...",
  "Connecting to MCP server...",
  "Server connection established.",
  "Starting scenario evaluation...",
  "Sending prompt to agent...",
  "Agent response received.",
  "Evaluating tool calls...",
  "Tool call validated: list_directory",
  "Checking eval rules...",
  "Scenario passed ✓",
  "Moving to next scenario...",
  "Sending prompt to agent...",
  "Agent response received.",
  "Evaluating tool calls...",
  "Tool call validated: read_file",
  "Checking eval rules...",
  "Scenario passed ✓",
  "All scenarios complete.",
  "Generating results summary...",
];

const RunEvaluation = () => {
  const [searchParams] = useSearchParams();
  const [configId, setConfigId] = useState("");
  const [varianceRuns, setVarianceRuns] = useState("1");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [runId, setRunId] = useState<string>("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [applySnapshotEval, setApplySnapshotEval] = useState(true);
  const [snapshotName, setSnapshotName] = useState("");
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const { configs, reload } = useConfigs();
  const { source, mode } = useDataSource();
  const { agents: libraryAgents, scenarios: libraryScenarios } = useLibraries();
  const selectedConfig = configs.find((item) => item.id === configId);
  const requestedConfigId = searchParams.get("configId");
  const availableAgents = useMemo(() => {
    if (!selectedConfig) return [];
    const byName = new Map<string, (typeof selectedConfig.agents)[number]>();
    for (const agent of selectedConfig.agents) {
      const key = agent.name || agent.id;
      if (!byName.has(key)) byName.set(key, agent);
    }
    for (const ref of selectedConfig.agentRefs ?? []) {
      if (byName.has(ref)) continue;
      const fromLibrary = libraryAgents.find((agent) => (agent.name || agent.id) === ref);
      if (fromLibrary) {
        byName.set(ref, fromLibrary);
      }
    }
    return Array.from(byName.values());
  }, [selectedConfig, libraryAgents]);
  const availableScenarios = useMemo(() => {
    if (!selectedConfig) return [];
    const byId = new Map<string, (typeof selectedConfig.scenarios)[number]>();
    for (const scenario of selectedConfig.scenarios) {
      if (!byId.has(scenario.id)) byId.set(scenario.id, scenario);
    }
    for (const ref of selectedConfig.scenarioRefs ?? []) {
      if (byId.has(ref)) continue;
      const fromLibrary = libraryScenarios.find((scenario) => scenario.id === ref || scenario.name === ref);
      if (fromLibrary) byId.set(ref, fromLibrary);
    }
    return Array.from(byId.values());
  }, [selectedConfig, libraryScenarios]);
  useEffect(() => {
    if (!requestedConfigId) return;
    if (!configs.some((config) => config.id === requestedConfigId)) return;
    setConfigId(requestedConfigId);
  }, [requestedConfigId, configs]);

  useEffect(() => {
    if (!selectedConfig) {
      setSelectedAgentIds([]);
      setSelectedScenarioIds([]);
      return;
    }
    const configuredDefaultAgentIds = availableAgents
      .filter((agent) =>
        (selectedConfig.runDefaults?.selectedAgentNames ?? []).includes(agent.name || agent.id)
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

  const runDemo = () => {
    setRunning(true);
    setDone(false);
    setRunId("");
    setLogs([]);
    setProgress(0);
    let idx = 0;
    intervalRef.current = setInterval(() => {
      if (idx < logMessages.length) {
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${logMessages[idx]}`]);
        setProgress(((idx + 1) / logMessages.length) * 100);
        idx++;
      } else {
        clearInterval(intervalRef.current!);
        setRunning(false);
        setDone(true);
        setRunId("run-a1b2c3");
      }
    }, 400);
  };

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
    setRunId("");
    const compositionMode =
      (selectedConfig.serverRefs?.length || 0) +
        (selectedConfig.agentRefs?.length || 0) +
        (selectedConfig.scenarioRefs?.length || 0) >
      0
        ? "refs-composed"
        : "single-file/inline";
    setLogs([
      `[${new Date().toLocaleTimeString()}] Starting evaluation run...`,
      `[${new Date().toLocaleTimeString()}] Config=${selectedConfig.name} mode=${compositionMode} agents=${selectedAgents.map((a) => a.name || a.id).join(", ")} tests=${selectedScenarios.map((s) => s.id).join(", ")} runs=${Number(varianceRuns)} snapshotEval=${applySnapshotEval ? "on" : "off"}`
    ]);
    setProgress(10);
    try {
      const { jobId } = await source.startRun({
        configPath: selectedConfig.sourcePath,
        runsPerScenario: Number(varianceRuns),
        agents: selectedAgents.map((agent) => agent.name || agent.id),
        scenarioIds: selectedScenarios.map((scenario) => scenario.id),
        applySnapshotEval,
      });
      setActiveJobId(jobId);
      setActiveRunJob(jobId);
      attachRunJob(jobId);
    } catch (error: any) {
      const message = String(error?.message ?? error);
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
    if (mode === "workspace") {
      void startWorkspaceRun();
      return;
    }
    runDemo();
  };

  const stopRun = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (mode === "workspace" && activeJobId) {
      void source.stopRun(activeJobId);
    }
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    clearActiveRunJob();
    setActiveJobId(null);
    setRunning(false);
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Run aborted by user.`]);
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
    } catch (error: any) {
      toast({
        title: "Could not save snapshot",
        description: String(error?.message ?? error),
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
    if (intervalRef.current) clearInterval(intervalRef.current);
    unsubscribeRef.current?.();
  }, []);

  useEffect(() => {
    if (mode !== "workspace" || activeJobId || done) return;
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
  }, [mode, activeJobId, done]);

  useEffect(() => {
    void reload();
    const handleFocus = () => {
      void reload();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [reload]);

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

  const attachRunJob = (jobId: string) => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = source.subscribeRunJob(jobId, (event) => {
      const ts = new Date(event.ts).toLocaleTimeString();
      if (event.type === "started") {
        setLogs((prev) => {
          const line = `[${ts}] Run started.`;
          return prev.includes(line) ? prev : [...prev, line];
        });
        setProgress((prev) => Math.max(prev, 30));
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
            if (lower.startsWith("running evaluation")) return Math.max(prev, 55);
            if (lower.startsWith("evaluation execution finished")) return Math.max(prev, 75);
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
        setRunId(nextRunId);
        clearActiveRunJob();
        setActiveJobId(null);
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
      }
      if (event.type === "error") {
        const message = String(event.payload.message ?? "Unknown error");
        const extraHint = message.includes("Anthropic model not found")
          ? " Hint: this usually means the API key works but the model ID is not enabled for that Anthropic account. Change the agent model in Manage Agents (library) or inline config."
          : "";
        setLogs((prev) => [...prev, `[${ts}] Error: ${message}${extraHint}`]);
        setRunning(false);
        setDone(false);
        setProgress(0);
        clearActiveRunJob();
        setActiveJobId(null);
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Run Evaluation</h1>
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
                  onClick={() => void reload()}
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
          {selectedConfig && (
            <div className="space-y-2">
              {selectedConfig.snapshotEval?.enabled && (
                <div className="rounded-md border bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                  Snapshot eval active ({selectedConfig.snapshotEval.mode}) · baseline:{" "}
                  <span className="font-mono">{selectedConfig.snapshotEval.baselineSnapshotId ?? "none"}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label>Agents</Label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setSelectedAgentIds(availableAgents.map((agent) => agent.id))}
                >
                  Select all
                </button>
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
          <label className="flex items-center gap-2 text-sm rounded-md border p-2">
            <Checkbox checked={applySnapshotEval} onCheckedChange={(v) => setApplySnapshotEval(v === true)} />
            <span>Apply snapshot evaluation policy (if configured)</span>
          </label>
          <div className="flex gap-2">
            <Button
              onClick={startRun}
              disabled={
                running ||
                !configId ||
                (availableAgents.length > 0 && selectedAgentIds.length === 0) ||
                (availableScenarios.length > 0 && selectedScenarioIds.length === 0)
              }
            >
              <Play className="mr-2 h-4 w-4" />Run
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
                <Link to={`/results/${runId || "run-a1b2c3"}${configId ? `?configId=${encodeURIComponent(configId)}` : ""}`}>View Results</Link>
              </Button>
            </div>
            {mode === "workspace" && runId && (
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
