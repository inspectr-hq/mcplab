import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Upload, MoreHorizontal, Copy, Trash2, Pencil, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown, AlertTriangle, FlaskConical, Play, Folder, Home, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/SearchInput";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfigs } from "@/contexts/ConfigContext";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";

const displayConfigName = (cfg: { configName?: string; name: string }) =>
  cfg.configName?.trim() || cfg.name;
const ROOT_SUITE_LABEL = "(root)";
const ROOT_SUITE_SELECT_VALUE = "__ROOT__";
const COLLAPSED_SUITES_STORAGE_KEY = "mcplab.configurations.collapsedSuites";

type SuiteKey = string | null;

const suiteKeyForConfig = (cfg: { suitePath?: string }): SuiteKey =>
  cfg.suitePath && cfg.suitePath.trim().length > 0 ? cfg.suitePath.trim() : null;

const suiteLabelForKey = (suiteKey: SuiteKey): string => suiteKey ?? ROOT_SUITE_LABEL;
const suiteTokenForKey = (suiteKey: SuiteKey): string =>
  suiteKey === null ? ROOT_SUITE_SELECT_VALUE : `suite:${suiteKey}`;
const suiteKeyFromToken = (token: string): SuiteKey =>
  token === ROOT_SUITE_SELECT_VALUE ? null : token.startsWith("suite:") ? token.slice(6) : null;

const SUITE_ACCENT_CLASSES = [
  "bg-red-400",
  "bg-red-500",
  "bg-orange-400",
  "bg-orange-500",
  "bg-amber-400",
  "bg-amber-500",
  "bg-yellow-400",
  "bg-yellow-500",
  "bg-lime-400",
  "bg-lime-500",
  "bg-green-400",
  "bg-green-500",
  "bg-emerald-400",
  "bg-emerald-500",
  "bg-teal-400",
  "bg-teal-500",
  "bg-cyan-400",
  "bg-cyan-500",
  "bg-sky-400",
  "bg-sky-500",
  "bg-blue-400",
  "bg-blue-500",
  "bg-indigo-400",
  "bg-indigo-500",
  "bg-violet-400",
  "bg-violet-500",
  "bg-purple-400",
  "bg-purple-500",
  "bg-fuchsia-400",
  "bg-fuchsia-500",
  "bg-pink-400",
  "bg-pink-500",
  "bg-rose-400",
  "bg-rose-500",
];

function suiteAccentClass(suiteKey: SuiteKey): string {
  if (suiteKey === null) return "bg-slate-400";
  const hash = suiteKey
    .split("")
    .reduce((sum, char) => (sum + char.charCodeAt(0)) % SUITE_ACCENT_CLASSES.length, 0);
  return SUITE_ACCENT_CLASSES[hash] ?? "bg-slate-400";
}

const Configurations = () => {
  const { configs, deleteConfig, cloneConfig, loading, reload } = useConfigs();
  const { source } = useDataSource();
  const navigate = useNavigate();
  const [sortBy, setSortBy] = useState<"name" | "scenarios" | "agents" | "updatedAt">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [configFilter, setConfigFilter] = useState("");
  const [suiteFilter, setSuiteFilter] = useState<string>("all");
  const [collapsedSuites, setCollapsedSuites] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_SUITES_STORAGE_KEY);
      if (!raw) return new Set<string>();
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return new Set<string>();
      return new Set(parsed.filter((item): item is string => typeof item === "string"));
    } catch {
      return new Set<string>();
    }
  });
  const [runningSuites, setRunningSuites] = useState<Set<string>>(new Set());
  const normalizedConfigFilter = configFilter.trim().toLowerCase();

  const toggleSort = (next: typeof sortBy) => {
    if (sortBy === next) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(next);
    setSortDir(next === "updatedAt" ? "desc" : "asc");
  };

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

  const handleDelete = async (id: string, name: string) => {
    await deleteConfig(id);
    toast({ title: "Deleted", description: `"${name}" has been removed.` });
  };

  const handleClone = async (id: string) => {
    const cloned = await cloneConfig(id);
    toast({ title: "Cloned", description: `Created "${displayConfigName(cloned)}".` });
    navigate(`/mcp-evaluations/${cloned.id}`);
  };

  const agentCount = (cfg: (typeof configs)[number]) =>
    cfg.agentEntries?.length ?? cfg.agents?.length ?? 0;

  const scenarioCount = (cfg: (typeof configs)[number]) =>
    cfg.scenarioEntries?.length ?? cfg.scenarios?.length ?? 0;

  const suiteOptions = useMemo(() => {
    const next = new Set<SuiteKey>();
    for (const cfg of configs) next.add(suiteKeyForConfig(cfg));
    return Array.from(next).sort((a, b) => suiteLabelForKey(a).localeCompare(suiteLabelForKey(b)));
  }, [configs]);

  const filteredConfigs = useMemo(() => {
    return configs.filter((cfg) => {
      const suiteKey = suiteKeyForConfig(cfg);
      const selectedSuiteKey = suiteFilter === "all" ? undefined : suiteKeyFromToken(suiteFilter);
      const suiteLabel = suiteLabelForKey(suiteKey);
      if (selectedSuiteKey !== undefined && suiteKey !== selectedSuiteKey) {
        return false;
      }
      if (normalizedConfigFilter.length === 0) return true;
      const haystack = [
        displayConfigName(cfg),
        cfg.id,
        cfg.description ?? "",
        cfg.loadError ?? "",
        suiteLabel,
        cfg.relativePath ?? ""
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedConfigFilter);
    });
  }, [configs, normalizedConfigFilter, suiteFilter]);

  const sortedConfigs = useMemo(() => {
    const sorted = [...filteredConfigs].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") cmp = displayConfigName(a).localeCompare(displayConfigName(b));
      if (sortBy === "scenarios") cmp = scenarioCount(a) - scenarioCount(b);
      if (sortBy === "agents") cmp = agentCount(a) - agentCount(b);
      if (sortBy === "updatedAt") cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredConfigs, sortBy, sortDir]);

  const sortIcon = (key: typeof sortBy) => {
    if (sortBy !== key) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  const toggleSuiteCollapsed = (suiteToken: string) => {
    setCollapsedSuites((prev) => {
      const next = new Set(prev);
      if (next.has(suiteToken)) next.delete(suiteToken);
      else next.add(suiteToken);
      return next;
    });
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(
        COLLAPSED_SUITES_STORAGE_KEY,
        JSON.stringify(Array.from(collapsedSuites))
      );
    } catch {
      // ignore storage errors (private mode/quota)
    }
  }, [collapsedSuites]);

  const runSuite = async (suiteToken: string, suiteLabel: string, items: typeof sortedConfigs) => {
    if (runningSuites.has(suiteToken)) return;
    setRunningSuites((prev) => new Set(prev).add(suiteToken));
    try {
      const runnable = items.filter((cfg) => typeof cfg.sourcePath === "string" && cfg.sourcePath.trim().length > 0);
      if (runnable.length === 0) {
        toast({
          title: "No runnable evaluations",
          description: `Suite "${suiteLabel}" has no evaluation files with a source path.`,
          variant: "destructive",
        });
        return;
      }

      const outcomes = await Promise.allSettled(
        runnable.map((cfg) =>
          source.startRun({
          configPath: String(cfg.sourcePath),
          runsPerScenario: 1,
          applySnapshotEval: true,
          })
        )
      );
      const successCount = outcomes.filter((item) => item.status === "fulfilled").length;
      const failureCount = outcomes.length - successCount;
      const firstFailure = outcomes.find((item): item is PromiseRejectedResult => item.status === "rejected");
      const firstFailureMessage = firstFailure
        ? firstFailure.reason instanceof Error
          ? firstFailure.reason.message
          : String(firstFailure.reason)
        : undefined;

      toast({
        title: failureCount === 0 ? "Suite queued" : "Suite queued with errors",
        description:
          failureCount === 0
            ? `Queued ${successCount} evaluation${successCount === 1 ? "" : "s"} for suite "${suiteLabel}".`
            : `Queued ${successCount}/${runnable.length} evaluations for suite "${suiteLabel}" (${failureCount} failed${firstFailureMessage ? `: ${firstFailureMessage}` : ""}).`,
        variant: failureCount === 0 ? "default" : "destructive",
      });
    } catch (error: unknown) {
      toast({
        title: "Could not queue suite",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setRunningSuites((prev) => {
        const next = new Set(prev);
        next.delete(suiteToken);
        return next;
      });
    }
  };

  const groupedConfigs = useMemo(() => {
    const grouped = new Map<SuiteKey, typeof sortedConfigs>();
    for (const cfg of sortedConfigs) {
      const suiteKey = suiteKeyForConfig(cfg);
      const bucket = grouped.get(suiteKey);
      if (bucket) bucket.push(cfg);
      else grouped.set(suiteKey, [cfg]);
    }
    return Array.from(grouped.entries()).sort((a, b) =>
      suiteLabelForKey(a[0]).localeCompare(suiteLabelForKey(b[0]))
    );
  }, [sortedConfigs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <FlaskConical className="h-6 w-6" />
            MCP Evaluations
          </h1>
          <p className="text-sm text-muted-foreground">Manage your MCP evaluation suites</p>
        </div>
        <div className="flex gap-2">
          <SearchInput value={configFilter} onValueChange={setConfigFilter} placeholder="Search evaluations..." />
          <Select value={suiteFilter} onValueChange={setSuiteFilter}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="All suites" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All suites</SelectItem>
              {suiteOptions.map((suiteKey) => (
                <SelectItem key={suiteTokenForKey(suiteKey)} value={suiteTokenForKey(suiteKey)}>
                  {suiteLabelForKey(suiteKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            <RefreshCw className="mr-2 h-4 w-4" />Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" />Import YAML
          </Button>
          <Button size="sm" asChild>
            <Link to="/mcp-evaluations/new"><Plus className="mr-2 h-4 w-4" />Create New</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("name")}>
                    Name
                    {sortIcon("name")}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("scenarios")}>
                    Scenarios
                    {sortIcon("scenarios")}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("agents")}>
                    Agents
                    {sortIcon("agents")}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("updatedAt")}>
                    Last Updated
                    {sortIcon("updatedAt")}
                  </button>
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedConfigs.map(([suiteKey, items]) => {
                const suiteLabel = suiteLabelForKey(suiteKey);
                const suiteToken = suiteTokenForKey(suiteKey);
                const isCollapsed = collapsedSuites.has(suiteToken);
                const isRunning = runningSuites.has(suiteToken);
                return (
                <Fragment key={`suite-group-${suiteToken}`}>
                  <TableRow key={`suite-${suiteToken}`} className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={5} className="py-2">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="inline-flex h-6 items-center gap-2 text-xs leading-none hover:text-foreground"
                          onClick={() => toggleSuiteCollapsed(suiteToken)}
                          aria-expanded={!isCollapsed}
                          aria-label={`${isCollapsed ? "Expand" : "Collapse"} suite ${suiteLabel}`}
                        >
                          <ChevronRight
                            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                              isCollapsed ? "" : "rotate-90"
                            }`}
                            aria-hidden="true"
                          />
                          <span
                            className={`h-2 w-2 rounded-full ${suiteAccentClass(suiteKey)}`}
                            aria-hidden="true"
                          />
                          {suiteKey === null ? (
                            <Home className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          ) : (
                            <Folder className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span className="font-medium">{suiteLabel}</span>
                          <span className="text-muted-foreground">({items.length})</span>
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={isRunning}
                          onClick={() => void runSuite(suiteToken, suiteLabel, items)}
                        >
                          <Play className="mr-1 h-3.5 w-3.5" />
                          {isRunning ? "Queueing..." : "Run Suite"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {!isCollapsed && items.map((cfg) => (
                    <TableRow key={cfg.id}>
                      <TableCell>
                        <div>
                          <Link to={`/mcp-evaluations/${cfg.id}`} className="font-medium text-sm hover:text-primary">{displayConfigName(cfg)}</Link>
                          {cfg.loadError && (
                            <Badge variant="destructive" className="ml-2 align-middle text-[10px]">
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              Broken
                            </Badge>
                          )}
                          {cfg.relativePath && (
                            <div className="mt-0.5">
                              <span className="text-xs text-muted-foreground font-mono">{cfg.relativePath}</span>
                            </div>
                          )}
                          {cfg.loadError && (
                            <p className="text-xs text-destructive mt-0.5 break-all">
                              {cfg.loadError}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{scenarioCount(cfg)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{agentCount(cfg)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {new Date(cfg.updatedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/run?configId=${encodeURIComponent(cfg.id)}`}>
                              <Play className="h-3.5 w-3.5" />
                              Run
                            </Link>
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/mcp-evaluations/${cfg.id}`)}>
                                <Pencil className="mr-2 h-3.5 w-3.5" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void handleClone(cfg.id)}>
                                <Copy className="mr-2 h-3.5 w-3.5" />Clone
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => void handleDelete(cfg.id, displayConfigName(cfg))}>
                                <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              )})}
              {!loading && configs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    No MCP evaluations yet. Create your first one to get started.
                  </TableCell>
                </TableRow>
              )}
              {!loading && configs.length > 0 && sortedConfigs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    No MCP evaluations match this filter.
                  </TableCell>
                </TableRow>
              )}
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    Loading MCP evaluations...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Configurations;
