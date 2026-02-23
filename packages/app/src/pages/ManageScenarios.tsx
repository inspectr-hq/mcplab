import { Link, useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScenarioForm } from "@/components/config-editor/ScenarioForm";
import { useLibraries } from "@/contexts/LibraryContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ExternalLink, Pencil, ArrowLeft, Search, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useMemo, useState } from "react";

const ManageScenarios = () => {
  const { scenarioId } = useParams<{ scenarioId?: string }>();
  const navigate = useNavigate();
  const { scenarios, setScenarios, agents, servers, reload, loading } = useLibraries();
  const [query, setQuery] = useState("");
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "id" | "servers" | "evalRules" | "extractRules">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const selectedScenarioId = scenarioId ? decodeURIComponent(scenarioId) : undefined;
  const selectedIndex = selectedScenarioId
    ? scenarios.findIndex((scenario) => scenario.id === selectedScenarioId)
    : -1;
  const selectedScenario = selectedIndex >= 0 ? scenarios[selectedIndex] : undefined;

  const handleSaveSingle = async (nextSingle: typeof scenarios) => {
    const nextScenario = nextSingle[0];
    if (!selectedScenario || selectedIndex < 0 || !nextScenario) return;
    const next = [...scenarios];
    next[selectedIndex] = nextScenario;
    await setScenarios(next);
  };

  const handleAddScenario = async () => {
    const baseId = `scn-${Date.now()}`;
    let nextId = baseId;
    let suffix = 1;
    while (scenarios.some((scenario) => scenario.id === nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const nextScenario = {
      id: nextId,
      name: "",
      serverIds: [],
      prompt: "",
      evalRules: [],
      extractRules: []
    } as const;
    await setScenarios([...scenarios, nextScenario]);
    navigate(`/libraries/scenarios/${encodeURIComponent(nextId)}`);
    toast({ title: "Scenario created", description: `Opened ${nextId} for editing.` });
  };

  const scenarioServerNames = (serverIds: string[]) =>
    serverIds
      .map((id) => servers.find((server) => server.id === id))
      .filter(Boolean)
      .map((server) => server?.name || server?.id)
      .filter(Boolean) as string[];

  const serverFilterOptions = useMemo(() => {
    const allNames = new Set<string>();
    for (const scenario of scenarios) {
      for (const name of scenarioServerNames(scenario.serverIds)) allNames.add(name);
    }
    return Array.from(allNames).sort((a, b) => a.localeCompare(b));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, servers]);

  const filteredScenarios = useMemo(() => {
    const q = query.trim().toLowerCase();
    const next = scenarios.filter((scenario) => {
      const name = (scenario.name || "").toLowerCase();
      const id = scenario.id.toLowerCase();
      const prompt = (scenario.prompt || "").toLowerCase();
      const serverNames = scenarioServerNames(scenario.serverIds);
      if (serverFilter !== "all" && !serverNames.includes(serverFilter)) return false;
      if (!q) return true;
      return (
        name.includes(q) ||
        id.includes(q) ||
        prompt.includes(q) ||
        serverNames.some((serverName) => serverName.toLowerCase().includes(q))
      );
    });
    next.sort((a, b) => {
      const aServers = scenarioServerNames(a.serverIds);
      const bServers = scenarioServerNames(b.serverIds);
      let cmp = 0;
      switch (sortBy) {
        case "id":
          cmp = a.id.localeCompare(b.id);
          break;
        case "servers":
          cmp = aServers.length - bServers.length;
          break;
        case "evalRules":
          cmp = a.evalRules.length - b.evalRules.length;
          break;
        case "extractRules":
          cmp = a.extractRules.length - b.extractRules.length;
          break;
        case "name":
        default:
          cmp = (a.name || a.id).localeCompare(b.name || b.id);
          break;
      }
      if (cmp === 0) cmp = a.id.localeCompare(b.id);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return next;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, query, serverFilter, sortBy, sortDir, servers]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Manage Scenarios</h1>
          <p className="text-sm text-muted-foreground">
            Reusable scenario templates shared across configurations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedScenario && (
            <Button type="button" size="sm" variant="outline" onClick={() => navigate("/libraries/scenarios")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Overview
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {!selectedScenario && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Scenario Overview</CardTitle>
                <CardDescription>
                  Click a scenario to deep-link to a focused editor at <code className="font-mono">/libraries/scenarios/&lt;scenario-id&gt;</code>.
                </CardDescription>
              </div>
              <Button type="button" size="sm" onClick={() => void handleAddScenario()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Scenario
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 rounded-md border p-3 md:grid-cols-[1.6fr_1fr_1fr_auto]">
              <div className="space-y-1.5">
                <Label className="text-xs">Search</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, id, prompt, server..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Server Filter</Label>
                <Select value={serverFilter} onValueChange={setServerFilter}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All servers</SelectItem>
                    {serverFilterOptions.map((serverName) => (
                      <SelectItem key={serverName} value={serverName}>
                        {serverName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sort By</Label>
                <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="id">ID</SelectItem>
                    <SelectItem value="servers"># Servers</SelectItem>
                    <SelectItem value="evalRules"># Eval Rules</SelectItem>
                    <SelectItem value="extractRules"># Extract Rules</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Direction</Label>
                <Select value={sortDir} onValueChange={(value) => setSortDir(value as "asc" | "desc")}>
                  <SelectTrigger className="h-8 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Ascending</SelectItem>
                    <SelectItem value="desc">Descending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Showing {filteredScenarios.length} of {scenarios.length} scenario{scenarios.length !== 1 ? "s" : ""}.
            </div>
            {selectedScenarioId && !selectedScenario && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Scenario <code className="font-mono">{selectedScenarioId}</code> was not found.
              </div>
            )}
            {scenarios.length === 0 ? (
              <p className="text-sm text-muted-foreground">No library scenarios yet.</p>
            ) : filteredScenarios.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scenarios match the current filters.</p>
            ) : (
              <div className="grid gap-3">
                {filteredScenarios.map((scenario) => {
                  const isSelected = selectedScenarioId === scenario.id;
                  const href = `/libraries/scenarios/${encodeURIComponent(scenario.id)}`;
                  const serverNames = scenarioServerNames(scenario.serverIds);
                  return (
                    <div
                      key={scenario.id}
                      className={`rounded-lg border p-3 ${isSelected ? "border-primary bg-primary/5" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{scenario.name || scenario.id}</span>
                            <Badge variant="outline" className="font-mono text-[10px]">{scenario.id}</Badge>
                            {isSelected && <Badge>Selected</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                            <span>{serverNames.length} server{serverNames.length !== 1 ? "s" : ""}</span>
                            <span>{scenario.evalRules.length} eval rule{scenario.evalRules.length !== 1 ? "s" : ""}</span>
                            <span>{scenario.extractRules.length} extract rule{scenario.extractRules.length !== 1 ? "s" : ""}</span>
                          </div>
                          {serverNames.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {serverNames.map((serverName) => (
                                <Badge key={`${scenario.id}-${serverName}`} variant="secondary" className="text-[10px]">
                                  {serverName}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button type="button" size="sm" variant={isSelected ? "default" : "outline"} asChild>
                            <Link to={href}>
                              <Pencil className="mr-1.5 h-3.5 w-3.5" />
                              Edit
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              const absoluteUrl = `${window.location.origin}${href}`;
                              try {
                                await navigator.clipboard.writeText(absoluteUrl);
                                toast({ title: "Deeplink copied", description: absoluteUrl });
                              } catch {
                                toast({
                                  title: "Could not copy deeplink",
                                  description: absoluteUrl,
                                  variant: "destructive"
                                });
                              }
                            }}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedScenario ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Edit Scenario</CardTitle>
            <CardDescription>
              Focused editor for <code className="font-mono">{selectedScenario.id}</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-3">
            <ScenarioForm
              scenarios={[selectedScenario]}
              agents={agents}
              servers={servers}
              onChange={(next) => {
                void handleSaveSingle(next);
              }}
              allowAdd={false}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default ManageScenarios;
