import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScenarioForm } from '@/components/config-editor/ScenarioForm';
import { useLibraries } from '@/contexts/LibraryContext';
import { useDataSource } from '@/contexts/DataSourceContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
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
import { RefreshCw, Pencil, ArrowLeft, Search, Plus, Copy, Trash2, FileCode } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Scenario } from '@/types/eval';
import {
  clearGlobalCopilotPageContext,
  setGlobalCopilotPageContext
} from '@/lib/global-copilot-page-context';
import { registerGlobalCopilotAction } from '@/lib/global-copilot-actions';

const RESULT_ASSISTANT_HANDOFF_STORAGE_KEY = 'mcplab.resultAssistantScenarioHandoff';

const ManageTestCases = () => {
  const { testCaseId } = useParams<{ testCaseId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { source } = useDataSource();
  const { scenarios, setScenarios, agents, servers, reload, loading } = useLibraries();
  const [query, setQuery] = useState('');
  const [serverFilter, setServerFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'id' | 'servers' | 'evalRules' | 'extractRules'>(
    'name'
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [scenarioAssistantAgentName, setScenarioAssistantAgentName] = useState<string>('');
  const [draftScenario, setDraftScenario] = useState<Scenario | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const [saveError, setSaveError] = useState<string>('');
  const [assistantHandoffPrompt, setAssistantHandoffPrompt] = useState<string>('');
  const [assistantHandoffNonce, setAssistantHandoffNonce] = useState<number>(0);
  const [scenarioPendingDelete, setScenarioPendingDelete] = useState<Scenario | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const latestDraftRef = useRef<Scenario | null>(null);
  const saveSeqRef = useRef(0);
  const latestScenariosRef = useRef(scenarios);
  latestScenariosRef.current = scenarios;
  // Always current — useMemo recreates setScenarios when state changes, so we need a ref.
  const setScenariosFnRef = useRef(setScenarios);
  setScenariosFnRef.current = setScenarios;

  const selectedScenarioId = testCaseId ? decodeURIComponent(testCaseId) : undefined;
  const returnToParam = searchParams.get('returnTo')?.trim() || '';
  const returnToPath = returnToParam.startsWith('/') ? returnToParam : '';
  const selectedIndex = selectedScenarioId
    ? scenarios.findIndex((scenario) => scenario.id === selectedScenarioId)
    : -1;
  const selectedScenario = selectedIndex >= 0 ? scenarios[selectedIndex] : undefined;

  const persistSingleScenario = async (nextScenario: Scenario) => {
    if (!selectedScenario || selectedIndex < 0 || !nextScenario) return;
    const next = [...scenarios];
    next[selectedIndex] = nextScenario;
    await setScenarios(next);
  };

  const flushScenarioSave = async () => {
    const nextScenario = latestDraftRef.current;
    if (!nextScenario || !selectedScenario) return;
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      return;
    }
    saveInFlightRef.current = true;
    saveQueuedRef.current = false;
    const seq = ++saveSeqRef.current;
    setSaveStatus('saving');
    setSaveError('');
    try {
      await persistSingleScenario(nextScenario);
      if (seq === saveSeqRef.current) {
        setSaveStatus('saved');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (seq === saveSeqRef.current) {
        setSaveStatus('error');
        setSaveError(message);
      }
      toast({
        title: 'Could not save scenario',
        description: message,
        variant: 'destructive'
      });
    } finally {
      saveInFlightRef.current = false;
      if (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        void flushScenarioSave();
      }
    }
  };

  const scheduleScenarioSave = (nextScenario: Scenario) => {
    latestDraftRef.current = nextScenario;
    setSaveStatus('dirty');
    setSaveError('');
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushScenarioSave();
    }, 700);
  };

  const handleAddScenario = async () => {
    const baseId = `scn-${Date.now()}`;
    let nextId = baseId;
    let suffix = 1;
    while (scenarios.some((scenario) => scenario.id === nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const nextScenario: Scenario = {
      id: nextId,
      name: '',
      serverIds: [],
      prompt: '',
      evalRules: [],
      extractRules: []
    };
    await setScenarios([...scenarios, nextScenario]);
    navigate(`/libraries/test-cases/${encodeURIComponent(nextId)}`);
    toast({ title: 'Test case created', description: `Opened ${nextId} for editing.` });
  };

  const buildUniqueScenarioId = (base: string) => {
    const normalized =
      (base || `scn-${Date.now()}`)
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || `scn-${Date.now()}`;
    let nextId = normalized;
    let suffix = 1;
    while (scenarios.some((scenario) => scenario.id === nextId)) {
      nextId = `${normalized}-${suffix}`;
      suffix += 1;
    }
    return nextId;
  };

  const handleDuplicateScenario = async (scenarioToDuplicate: Scenario, navigateToCopy = false) => {
    const duplicateId = buildUniqueScenarioId(`${scenarioToDuplicate.id}-copy`);
    const duplicate: Scenario = {
      ...structuredClone(scenarioToDuplicate),
      id: duplicateId,
      name: scenarioToDuplicate.name ? `${scenarioToDuplicate.name} (Copy)` : ''
    };
    await setScenarios([...scenarios, duplicate]);
    toast({ title: 'Test case duplicated', description: `Created ${duplicate.id}.` });
    if (navigateToCopy) {
      navigate(`/libraries/test-cases/${encodeURIComponent(duplicate.id)}`);
    }
  };

  useEffect(
    () =>
      registerGlobalCopilotAction('duplicate_test_case', async ({ id }) => {
        const scenario = scenarios.find((item) => item.id === id);
        if (!scenario) throw new Error(`Test Case '${String(id)}' is no longer available.`);
        await handleDuplicateScenario(scenario);
      }),
    [scenarios, handleDuplicateScenario]
  );

  const confirmDeleteScenario = async (scenarioToDelete: Scenario) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const next = scenarios.filter((scenario) => scenario.id !== scenarioToDelete.id);
    await setScenarios(next);
    toast({ title: 'Test case deleted', description: `${scenarioToDelete.id} was removed.` });
    if (selectedScenario?.id === scenarioToDelete.id) {
      setDraftScenario(null);
      latestDraftRef.current = null;
      setSaveStatus('idle');
      setSaveError('');
      navigate('/libraries/test-cases');
    }
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
      const name = (scenario.name || '').toLowerCase();
      const id = scenario.id.toLowerCase();
      const prompt = (scenario.prompt || '').toLowerCase();
      const serverNames = scenarioServerNames(scenario.serverIds);
      if (serverFilter !== 'all' && !serverNames.includes(serverFilter)) return false;
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
        case 'id':
          cmp = a.id.localeCompare(b.id);
          break;
        case 'servers':
          cmp = aServers.length - bServers.length;
          break;
        case 'evalRules':
          cmp = a.evalRules.length - b.evalRules.length;
          break;
        case 'extractRules':
          cmp = a.extractRules.length - b.extractRules.length;
          break;
        case 'name':
        default:
          cmp = (a.name || a.id).localeCompare(b.name || b.id);
          break;
      }
      if (cmp === 0) cmp = a.id.localeCompare(b.id);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, query, serverFilter, sortBy, sortDir, servers]);

  useEffect(() => {
    setGlobalCopilotPageContext({
      testCases: {
        serverFilter,
        ...(query.trim() ? { searchQuery: query.trim() } : {}),
        visibleCount: filteredScenarios.length,
        totalCount: scenarios.length
      }
    });
    return () => clearGlobalCopilotPageContext();
  }, [filteredScenarios.length, query, scenarios.length, serverFilter]);

  useEffect(() => {
    let active = true;
    source
      .getWorkspaceSettings()
      .then((settings) => {
        if (!active || !settings) return;
        setScenarioAssistantAgentName(settings.scenarioAssistantAgentName ?? '');
      })
      .catch(() => {
        if (!active) return;
        setScenarioAssistantAgentName('');
      });
    return () => {
      active = false;
    };
  }, [source]);

  useEffect(() => {
    if (!selectedScenarioId) return;
    if (searchParams.get('assistantHandoff') !== '1') return;
    try {
      const raw = window.sessionStorage.getItem(RESULT_ASSISTANT_HANDOFF_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        scenarioId?: string;
        prompt?: string;
      };
      if (!parsed || parsed.scenarioId !== selectedScenarioId || !parsed.prompt) return;
      setAssistantHandoffPrompt(String(parsed.prompt));
      setAssistantHandoffNonce(Date.now());
      window.sessionStorage.removeItem(RESULT_ASSISTANT_HANDOFF_STORAGE_KEY);
      const next = new URLSearchParams(searchParams);
      next.delete('assistantHandoff');
      setSearchParams(next, { replace: true });
      toast({
        title: 'Suggestion sent to Scenario Assistant',
        description: 'Review the suggestion and apply changes in the scenario editor.'
      });
    } catch {
      // Ignore malformed handoff payloads.
    }
  }, [selectedScenarioId, searchParams, setSearchParams]);

  useEffect(() => {
    const hasPendingChanges = saveTimerRef.current !== null || saveInFlightRef.current;
    const pendingDraft = latestDraftRef.current;

    // Same scenario + pending changes: window-focus reload guard — do not overwrite the draft.
    if (selectedScenario && pendingDraft?.id === selectedScenario.id && hasPendingChanges) {
      return;
    }

    // Switching away from a different scenario with unsaved changes: flush them now so the
    // user's last edit is not silently discarded.  Two sub-cases:
    //   a) Timer pending (debounce hasn't fired yet): cancel it and save immediately.
    //   b) Save in-flight with queued edits (more edits happened while S1 was saving):
    //      zero the queue flag before S1's finally block runs, then fire S2 directly.
    //      S1 and S2 may race, but S2 has the latest data so it's fine if it lands last.
    const isScenarioSwitch = !!pendingDraft && pendingDraft.id !== selectedScenario?.id;
    if (isScenarioSwitch && (saveTimerRef.current !== null || saveQueuedRef.current)) {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveQueuedRef.current = false;
      const currentScenarios = latestScenariosRef.current;
      const indexToSave = currentScenarios.findIndex((s) => s.id === pendingDraft.id);
      if (indexToSave >= 0) {
        const next = [...currentScenarios];
        next[indexToSave] = pendingDraft;
        void setScenariosFnRef.current(next);
      }
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveInFlightRef.current = false;
    saveQueuedRef.current = false;

    if (selectedScenario) {
      setDraftScenario(structuredClone(selectedScenario));
      latestDraftRef.current = structuredClone(selectedScenario);
      setSaveStatus('idle');
      setSaveError('');
    } else {
      setDraftScenario(null);
      latestDraftRef.current = null;
      setSaveStatus('idle');
      setSaveError('');
    }
  }, [selectedScenario]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const effectiveAssistantAgentName = scenarioAssistantAgentName || agents[0]?.name || '';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <FileCode className="h-6 w-6" />
            Manage Test Cases
          </h1>
          <p className="text-sm text-muted-foreground">
            Reusable test case templates shared across configurations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedScenario && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => navigate('/libraries/test-cases')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Overview
            </Button>
          )}
          {selectedScenario && returnToPath && (
            <Button type="button" size="sm" variant="outline" asChild>
              <Link to={returnToPath}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to evaluation
              </Link>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void reload()}
            disabled={loading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          {!selectedScenario && (
            <Button type="button" size="sm" onClick={() => void handleAddScenario()}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Test Case
            </Button>
          )}
        </div>
      </div>

      {!selectedScenario && (
        <>
          <div className="grid gap-3 rounded-md border bg-muted/30 p-3 md:grid-cols-[1.6fr_1fr_1fr_auto]">
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
              <Select
                value={sortDir}
                onValueChange={(value) => setSortDir(value as 'asc' | 'desc')}
              >
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
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="text-xs text-muted-foreground">
                Showing {filteredScenarios.length} of {scenarios.length} test case
                {scenarios.length !== 1 ? 's' : ''}.
              </div>
              {selectedScenarioId && !selectedScenario && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Test case <code className="font-mono">{selectedScenarioId}</code> was not found.
                </div>
              )}
              {scenarios.length === 0 ? (
                <p className="text-sm text-muted-foreground">No library test cases yet.</p>
              ) : filteredScenarios.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No test cases match the current filters.
                </p>
              ) : (
                <div className="grid gap-3">
                  {filteredScenarios.map((scenario) => {
                    const isSelected = selectedScenarioId === scenario.id;
                    const href = `/libraries/test-cases/${encodeURIComponent(scenario.id)}`;
                    const serverNames = scenarioServerNames(scenario.serverIds);
                    return (
                      <div
                        key={scenario.id}
                        className={`rounded-lg border p-3 ${
                          isSelected ? 'border-primary bg-primary/5' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link to={href} className="font-medium truncate hover:underline">
                                {scenario.name || scenario.id}
                              </Link>
                              <Badge variant="outline" className="font-mono text-[10px]">
                                {scenario.id}
                              </Badge>
                              {isSelected && <Badge>Selected</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                              <span>
                                {serverNames.length} server{serverNames.length !== 1 ? 's' : ''}
                              </span>
                              <span>
                                {scenario.evalRules.length} eval rule
                                {scenario.evalRules.length !== 1 ? 's' : ''}
                              </span>
                              <span>
                                {scenario.extractRules.length} extract rule
                                {scenario.extractRules.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            {serverNames.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {serverNames.map((serverName) => (
                                  <Badge
                                    key={`${scenario.id}-${serverName}`}
                                    variant="secondary"
                                    className="text-[10px]"
                                  >
                                    {serverName}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setScenarioPendingDelete(scenario)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Delete
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void handleDuplicateScenario(scenario)}
                            >
                              <Copy className="mr-1.5 h-3.5 w-3.5" />
                              Duplicate
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={isSelected ? 'default' : 'outline'}
                              asChild
                            >
                              <Link to={href}>
                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                Edit
                              </Link>
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
        </>
      )}

      {selectedScenario && draftScenario ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">
                    Edit Test Case ·{' '}
                    <code className="font-mono text-muted-foreground">{selectedScenario.id}</code>
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      saveStatus === 'saving'
                        ? 'border-amber-300 text-amber-700'
                        : saveStatus === 'saved'
                        ? 'border-emerald-300 text-emerald-700'
                        : saveStatus === 'error'
                        ? 'border-destructive/40 text-destructive'
                        : saveStatus === 'dirty'
                        ? 'border-sky-300 text-sky-700'
                        : ''
                    }`}
                  >
                    {saveStatus === 'saving'
                      ? 'Saving...'
                      : saveStatus === 'saved'
                      ? 'Saved'
                      : saveStatus === 'error'
                      ? 'Save failed'
                      : saveStatus === 'dirty'
                      ? 'Unsaved changes'
                      : 'Ready'}
                  </Badge>
                </div>
                {saveStatus === 'error' && saveError && (
                  <div className="text-[11px] text-destructive">{saveError}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDuplicateScenario(draftScenario, true)}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Duplicate
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setScenarioPendingDelete(draftScenario)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            <ScenarioForm
              scenarios={[draftScenario]}
              agents={agents}
              servers={servers}
              defaultAssistantAgentName={effectiveAssistantAgentName}
              assistantInitialPromptByScenarioId={
                assistantHandoffPrompt && draftScenario?.id
                  ? { [draftScenario.id]: assistantHandoffPrompt }
                  : undefined
              }
              assistantAutoOpenNonceByScenarioId={
                draftScenario?.id && assistantHandoffNonce
                  ? { [draftScenario.id]: assistantHandoffNonce }
                  : undefined
              }
              onChange={(next) => {
                const nextScenario = next[0];
                if (!nextScenario) return;
                setDraftScenario(nextScenario);
                scheduleScenarioSave(nextScenario);
              }}
              allowAdd={false}
            />
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog
        open={Boolean(scenarioPendingDelete)}
        onOpenChange={(open) => !open && setScenarioPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete test case?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{' '}
              <span className="font-medium">
                {scenarioPendingDelete?.name || scenarioPendingDelete?.id}
              </span>{' '}
              from the library. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!scenarioPendingDelete) return;
                void confirmDeleteScenario(scenarioPendingDelete);
                setScenarioPendingDelete(null);
              }}
            >
              Delete Test Case
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ManageTestCases;
