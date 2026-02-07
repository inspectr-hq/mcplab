import { useState, useEffect, useRef } from "react";
import { Play, Square, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mockConfigs } from "@/data/mock-data";
import { Link } from "react-router-dom";

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
  const [configId, setConfigId] = useState("");
  const [varianceRuns, setVarianceRuns] = useState("3");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const startRun = () => {
    setRunning(true);
    setDone(false);
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
      }
    }, 400);
  };

  const stopRun = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Run aborted by user.`]);
  };

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

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
              <Label>Configuration</Label>
              <Select value={configId} onValueChange={setConfigId}>
                <SelectTrigger><SelectValue placeholder="Select a config" /></SelectTrigger>
                <SelectContent>
                  {mockConfigs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Variance Runs</Label>
              <Input type="number" min="1" max="10" value={varianceRuns} onChange={(e) => setVarianceRuns(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={startRun} disabled={running || !configId}>
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
                <Link to="/results/run-a1b2c3">View Results</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default RunEvaluation;
