import { Fragment, useCallback, useEffect, useState, useRef } from 'react';
import { Bot, CheckCircle2, Copy, Loader2, Minimize2, Sparkles, Wrench, X } from 'lucide-react';
import {
  AssistantComposer,
  AssistantMessageRow,
  AssistantToolCallCard,
  AssistantTypingIndicator
} from '@/components/assistant/AssistantChat';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDataSource } from '@/contexts/DataSourceContext';
import { toast } from '@/hooks/use-toast';
import { isAbortError } from '@/lib/abort';
import { ensureOAuthForServers } from '@/lib/oauth-session-utils';
import type { AgentConfig, EvalRule, Scenario, ServerConfig } from '@/types/eval';
import type {
  ScenarioAssistantSessionView,
  ScenarioAssistantSuggestionBundle,
  ScenarioAssistantPendingToolCall
} from '@/lib/data-sources/types';

const SCENARIO_ASSISTANT_SNIPPETS = [
  {
    label: 'Suggest Checks',
    description: 'Propose stronger evaluation checks for this scenario.',
    prompt:
      'Review the current checks in this scenario and suggest stronger alternatives. For each suggestion, explain what failure mode it catches that the existing checks miss. Prioritize checks that are deterministic, not sensitive to minor phrasing changes, and that would reliably catch regressions.'
  },
  {
    label: 'Suggest Value Capture Rules',
    description: 'Recommend extract/value capture rules for key outputs.',
    prompt:
      'Analyze the expected tool calls and outputs in this scenario and suggest value capture rules that extract the most meaningful structured data. For each rule, explain which field to capture, why it matters for evaluation, and what a good vs. bad captured value looks like.'
  },
  {
    label: 'Generate Structured Updates',
    description: 'Return apply-ready Checks and Value Capture suggestions.',
    prompt: [
      'Propose concrete scenario updates and include structured suggestions that can be applied directly.',
      'Return ONLY valid JSON envelope and no markdown.',
      'Required shape:',
      '{"type":"assistant_message","text":"short rationale","suggestions":{"evalRules":{"replacement":[...]}, "extractRules":{"replacement":[...]}}}',
      'If tool usage is clear, include at least one required_tool check.',
      'Prefer deterministic checks and concise capture patterns.'
    ].join('\n')
  },
  {
    label: 'Improve Prompt Determinism',
    description: 'Reduce ambiguity and improve reproducibility.',
    prompt:
      "Identify parts of this scenario's prompt or context that are ambiguous, open-ended, or likely to produce different results across runs. Suggest specific rewrites that make the expected behavior more deterministic — without changing the intent of what is being tested."
  },
  // Commented out for now, as the snapshot is still WIP
  // {
  //   label: "Explain Snapshot Drift Risk",
  //   description: "Assess likely causes of drift and stabilization options.",
  //   prompt:
  //     "Assess this scenario for snapshot drift risk. Which parts of the expected output are most likely to change as the underlying model or tool evolves? Explain the root cause for each risk and suggest whether to stabilize via tighter prompting, value capture rules, or more flexible checks."
  // },
  {
    label: 'Generate Scenario Draft',
    description: 'Create a draft scenario from the current context.',
    prompt:
      'Based on the current tool configuration and context, generate a complete scenario draft. Include a clear prompt, realistic expected tool calls with arguments, meaningful checks that validate the core behavior, and at least one value capture rule. Explain your choices so I can adjust them.'
  }
] as const;

interface ScenarioAssistantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId?: string;
  configPath?: string;
  scenario: Scenario;
  agents: AgentConfig[];
  servers: ServerConfig[];
  defaultAssistantAgentName?: string;
  initialUserMessage?: string;
  onApplyPatch: (patch: {
    prompt?: string;
    evalRules?: Scenario['evalRules'];
    extractRules?: Scenario['extractRules'];
  }) => void;
}

export function ScenarioAssistantDialog({
  open,
  onOpenChange,
  configId,
  configPath,
  scenario,
  agents,
  servers,
  defaultAssistantAgentName,
  initialUserMessage,
  onApplyPatch
}: ScenarioAssistantDialogProps) {
  const { source } = useDataSource();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<ScenarioAssistantSessionView | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnCancelable, setTurnCancelable] = useState(false);
  const [appliedSuggestionKeys, setAppliedSuggestionKeys] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const initialMessageSentRef = useRef<string | null>(null);
  const assistantTurnRef = useRef<{
    id: number;
    controller: AbortController;
    prompt: string;
  } | null>(null);
  const assistantTurnCounterRef = useRef(0);
  const [preserveSessionOnClose, setPreserveSessionOnClose] = useState(false);
  const preserveSessionOnCloseRef = useRef(false);
  const resolvedAssistantAgentName = defaultAssistantAgentName || agents[0]?.id || '';

  const abortActiveAssistantTurn = useCallback(() => {
    const activeTurn = assistantTurnRef.current;
    if (!activeTurn) return;
    activeTurn.controller.abort();
    // Don't null assistantTurnRef here — the finally block in sendMessage
    // guards on the turn ID to perform cleanup, and nulling the ref would
    // cause that guard to fail, bypassing setLoading(false).
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!resolvedAssistantAgentName || sessionId) return;
    let cancelled = false;
    setLoading(true);
    const bootstrap = async () => {
      const selectedOauthServers = Array.from(
        new Set(
          scenario.serverIds.filter((serverId) => {
            const server = servers.find((entry) => entry.id === serverId);
            return server?.authType === 'oauth2';
          })
        )
      );
      await ensureOAuthForServers({ serverNames: selectedOauthServers, source });

      const resp = await source.createScenarioAssistantSession({
        configId,
        configPath,
        scenarioId: scenario.id,
        selectedAssistantAgentName: resolvedAssistantAgentName,
        context: {
          scenario: {
            id: scenario.id,
            name: scenario.name,
            prompt: scenario.prompt,
            serverNames: scenario.serverIds,
            evalRules: scenario.evalRules,
            extractRules: scenario.extractRules
          },
          availableServers: servers.map((server) => ({
            name: server.name || server.id,
            url: server.url
          })),
          availableAgents: agents.map((agent) => ({
            name: agent.name || agent.id,
            provider: agent.provider,
            model: agent.model
          }))
        }
      });
      if (cancelled) return;
      setSessionId(resp.sessionId);
      syncScenarioAssistantSession(resp.session);
      setLoading(false);
    };
    void bootstrap()
      .catch((error: unknown) => {
        if (cancelled) return;
        toast({
          title: 'Could not start Scenario Assistant',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive'
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    source,
    sessionId,
    configId,
    configPath,
    scenario,
    agents,
    servers,
    resolvedAssistantAgentName
  ]);

  const resetLocalSessionState = () => {
    abortActiveAssistantTurn();
    setSessionId(null);
    setSession(null);
    setInput('');
    setAppliedSuggestionKeys(new Set());
    initialMessageSentRef.current = null;
  };

  const syncScenarioAssistantSession = useCallback((nextSession: ScenarioAssistantSessionView) => {
    setSession((prev) => {
      if (prev && prev.messages.length > nextSession.messages.length) {
        return prev;
      }
      return nextSession;
    });
  }, []);

  const cancelAssistantTurn = useCallback(() => {
    const activeTurn = assistantTurnRef.current;
    if (!activeTurn) return;
    abortActiveAssistantTurn();
    setInput(activeTurn.prompt);
    setLoading(false);
    setTurnCancelable(false);
  }, [abortActiveAssistantTurn]);

  const closeScenarioAssistantSession = (id: string) => {
    resetLocalSessionState();
    void source.closeScenarioAssistantSession(id).catch(() => {});
  };

  useEffect(() => {
    if (open) return;
    if (!sessionId) return;
    if (preserveSessionOnCloseRef.current || preserveSessionOnClose) return;
    closeScenarioAssistantSession(sessionId);
  }, [open, sessionId, source, preserveSessionOnClose]);

  useEffect(() => {
    return () => {
      abortActiveAssistantTurn();
      if (sessionId) {
        void source.closeScenarioAssistantSession(sessionId).catch(() => {});
      }
    };
  }, [abortActiveAssistantTurn, sessionId, source]);

  useEffect(() => {
    if (!open) return;
    if (preserveSessionOnClose) {
      setPreserveSessionOnClose(false);
    }
    if (preserveSessionOnCloseRef.current) {
      preserveSessionOnCloseRef.current = false;
    }
    const timeout = window.setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    open,
    loading,
    session?.messages.length,
    session?.pendingToolCalls.length,
    session?.warnings.length
  ]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(40, next)}px`;
  }, [input, open]);

  const canUseAssistant =
    agents.length > 0 && scenario.serverIds.length > 0 && Boolean(resolvedAssistantAgentName);

  const sendMessage = async (message: string) => {
    if (!sessionId) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    const turnId = ++assistantTurnCounterRef.current;
    const controller = new AbortController();
    const optimisticMessageId = `msg-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMessage: ScenarioAssistantSessionView['messages'][number] = {
      id: optimisticMessageId,
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString()
    };
    assistantTurnRef.current = { id: turnId, controller, prompt: trimmed };
    setTurnCancelable(true);
    setSession((prev) =>
      prev
        ? {
            ...prev,
            messages: [...prev.messages, optimisticMessage]
          }
        : prev
    );
    setInput('');
    setLoading(true);
    try {
      const resp = await source.sendScenarioAssistantMessage(sessionId, trimmed, controller.signal);
      if (controller.signal.aborted || assistantTurnRef.current?.id !== turnId) return;
      syncScenarioAssistantSession(resp.session);
    } catch (error: unknown) {
      if (
        isAbortError(error) ||
        controller.signal.aborted ||
        assistantTurnRef.current?.id !== turnId
      )
        return;
      setSession((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.filter((m) => m.id !== optimisticMessageId)
            }
          : prev
      );
      setInput((prev) => (prev.trim() ? prev : trimmed));
      toast({
        title: 'Scenario Assistant error',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      // cancelAssistantTurn() clears the ref synchronously, so only the active turn
      // should reset loading state here.
      if (assistantTurnRef.current?.id === turnId) {
        assistantTurnRef.current = null;
        setLoading(false);
        setTurnCancelable(false);
      }
    }
  };

  const applyScenarioSnippet = (snippet: string) => {
    setInput(snippet);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    if (!open || !sessionId || !session) return;
    if (!canUseAssistant) return;
    if (assistantTurnRef.current) return;
    const handoffMessage = String(initialUserMessage ?? '').trim();
    if (!handoffMessage) return;
    if (initialMessageSentRef.current === handoffMessage) return;
    initialMessageSentRef.current = handoffMessage;
    void sendMessage(handoffMessage);
  }, [open, sessionId, session, canUseAssistant, initialUserMessage]);

  useEffect(() => {
    if (!open || !sessionId || !session) return;
    return source.subscribeScenarioAssistantSessionEvents(sessionId, (event) => {
      syncScenarioAssistantSession(event.payload.session);
    });
  }, [open, sessionId, source, syncScenarioAssistantSession]);

  const handleApprove = async (callId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const resp = await source.approveScenarioAssistantToolCall(sessionId, callId);
      syncScenarioAssistantSession(resp.session);
    } catch (error: unknown) {
      toast({
        title: 'Tool call failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async (callId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const resp = await source.denyScenarioAssistantToolCall(sessionId, callId);
      syncScenarioAssistantSession(resp.session);
    } catch (error: unknown) {
      toast({
        title: 'Could not deny tool call',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAll = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const resp = await source.approveAllScenarioAssistantToolCalls(sessionId);
      syncScenarioAssistantSession(resp.session);
    } catch (error: unknown) {
      toast({
        title: 'Could not approve all tool calls',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const applySuggestions = (
    messageId: string | undefined,
    suggestions: ScenarioAssistantSuggestionBundle | undefined,
    key: 'prompt' | 'evalRules' | 'extractRules'
  ) => {
    if (!suggestions) return;
    if (key === 'prompt' && suggestions.prompt) {
      onApplyPatch({ prompt: suggestions.prompt.replacement });
    }
    if (key === 'evalRules' && suggestions.evalRules) {
      onApplyPatch({
        evalRules: suggestions.evalRules.replacement as Array<{
          type: EvalRule['type'];
          value?: string;
          path?: string;
          equals?: string | number | boolean;
        }>
      });
    }
    if (key === 'extractRules' && suggestions.extractRules) {
      onApplyPatch({ extractRules: suggestions.extractRules.replacement });
    }
    if (messageId) {
      const composite = `${messageId}:${key}`;
      setAppliedSuggestionKeys((prev) => new Set([...prev, composite]));
    }
    const labelByKey: Record<typeof key, string> = {
      prompt: 'Prompt',
      evalRules: 'Checks',
      extractRules: 'Value Capture Rules'
    };
    toast({ title: 'Applied suggestion', description: `Updated ${labelByKey[key]}` });
  };

  const blurActiveElement = () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      blurActiveElement();
      setPreserveSessionOnClose(false);
      preserveSessionOnCloseRef.current = false;
    }
    onOpenChange(nextOpen);
  };

  const handleMinimize = () => {
    blurActiveElement();
    preserveSessionOnCloseRef.current = true;
    setPreserveSessionOnClose(true);
    onOpenChange(false);
  };

  const handleDiscardMinimizedSession = () => {
    blurActiveElement();
    preserveSessionOnCloseRef.current = false;
    setPreserveSessionOnClose(false);
    if (sessionId) closeScenarioAssistantSession(sessionId);
  };

  return (
    <>
      {!open && sessionId && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">Scenario Assistant (session active)</p>
            <p className="truncate text-xs text-muted-foreground">
              Resume conversation for <span className="font-mono">{scenario.id}</span>
              {session ? ` · ${session.messages.length} messages` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(true)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Resume
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-muted-foreground"
              onClick={handleDiscardMinimizedSession}
              aria-label="Discard assistant session"
              title="Discard assistant session"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-w-6xl h-[85vh] flex flex-col">
          {sessionId && (
            <button
              type="button"
              className="absolute right-12 top-4 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              onClick={handleMinimize}
              aria-label="Minimize assistant"
              title="Minimize assistant"
            >
              <Minimize2 className="h-4 w-4" />
              <span className="sr-only">Minimize</span>
            </button>
          )}
          <DialogHeader className="pr-20">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Scenario Assistant
                </DialogTitle>
                <DialogDescription>
                  LLM-guided scenario authoring with MCP tool introspection and per-tool-call
                  approval.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {!canUseAssistant ? (
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              Scenario Assistant requires a configured assistant agent and at least one selected
              server on the scenario.
            </div>
          ) : (
            <div className="min-h-0 flex flex-1 flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-1">
                <div className="space-y-1.5">
                  <Label className="text-xs">MCP Context</Label>
                  <div className="h-8 rounded-md border px-2 text-xs flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5" />
                    {session ? `Loaded ${session.toolsLoaded} tools` : 'Preparing...'}
                  </div>
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1 rounded-md border p-3">
                <div className="space-y-3">
                  {session?.warnings?.map((warning, index) => (
                    <div
                      key={`${warning}-${index}`}
                      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                    >
                      {warning}
                    </div>
                  ))}
                  {session?.messages.map((message) => (
                    <Fragment key={message.id}>
                      {(() => {
                        const toolCallIds =
                          message.pendingToolCallIds ??
                          (message.pendingToolCallId ? [message.pendingToolCallId] : []);
                        const linkedPendingToolCalls = toolCallIds
                          .map((id) =>
                            (session?.pendingToolCalls ?? []).find((call) => call.id === id)
                          )
                          .filter((call): call is ScenarioAssistantPendingToolCall =>
                            Boolean(call)
                          );
                        const allToolCalls = toolCallIds
                          .map(
                            (id) =>
                              session.pendingToolCalls.find((c) => c.id === id) ??
                              session.pendingToolCalls.find((c) => c.id === id)
                          )
                          .filter(Boolean) as ScenarioAssistantPendingToolCall[];
                        const isAssistantToolRequest =
                          message.role === 'assistant' && toolCallIds.length > 0;
                        if (!isAssistantToolRequest) {
                          return (
                            <div className="space-y-2">
                              <ScenarioAssistantMessageRow message={message} />
                            </div>
                          );
                        }
                        const pendingCount = linkedPendingToolCalls.length;
                        const resolvedCount = allToolCalls.length - pendingCount;
                        return (
                          <div className="flex items-start gap-2">
                            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                              <Bot className="h-3 w-3" />
                            </div>
                            <div className="w-full max-w-[92%] space-y-2">
                              {allToolCalls.length > 1 && pendingCount > 0 && (
                                <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-1.5">
                                  <span className="text-xs text-amber-900">
                                    {resolvedCount} of {allToolCalls.length} tool calls resolved
                                  </span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    disabled={pendingCount === 0}
                                    onClick={() => void handleApproveAll()}
                                  >
                                    Approve All ({pendingCount})
                                  </Button>
                                </div>
                              )}
                              {allToolCalls.map((call, idx) => (
                                <AssistantToolCallCard
                                  key={call.id}
                                  call={call}
                                  loading={loading}
                                  description={idx === 0 ? message.text : undefined}
                                  onApprove={(callId) => void handleApprove(callId)}
                                  onDeny={(callId) => void handleDeny(callId)}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                      {message.suggestions && (
                        <div className="ml-0 space-y-3 rounded-md border border-dashed bg-muted/10 p-3">
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Sparkles className="h-3.5 w-3.5" />
                            Structured Suggestions
                          </div>
                          {message.suggestions.prompt && (
                            <SuggestionCard
                              title="Prompt"
                              rationale={message.suggestions.prompt.rationale}
                              preview={message.suggestions.prompt.replacement}
                              applied={appliedSuggestionKeys.has(`${message.id}:prompt`)}
                              onApply={() =>
                                applySuggestions(message.id, message.suggestions, 'prompt')
                              }
                            />
                          )}
                          {message.suggestions.evalRules && (
                            <SuggestionCard
                              title="Checks"
                              rationale={message.suggestions.evalRules.rationale}
                              preview={JSON.stringify(
                                message.suggestions.evalRules.replacement,
                                null,
                                2
                              )}
                              applied={appliedSuggestionKeys.has(`${message.id}:evalRules`)}
                              onApply={() =>
                                applySuggestions(message.id, message.suggestions, 'evalRules')
                              }
                            />
                          )}
                          {message.suggestions.extractRules && (
                            <SuggestionCard
                              title="Value Capture Rules"
                              rationale={message.suggestions.extractRules.rationale}
                              preview={JSON.stringify(
                                message.suggestions.extractRules.replacement,
                                null,
                                2
                              )}
                              applied={appliedSuggestionKeys.has(`${message.id}:extractRules`)}
                              onApply={() =>
                                applySuggestions(message.id, message.suggestions, 'extractRules')
                              }
                            />
                          )}
                          {(() => {
                            const rawNotes = message.suggestions?.notes;
                            const notes = Array.isArray(rawNotes)
                              ? rawNotes
                              : typeof rawNotes === 'string'
                              ? [rawNotes]
                              : [];
                            if (notes.length === 0) return null;
                            return (
                              <div className="space-y-2 rounded-md border p-3">
                                <h5 className="text-sm font-medium">Notes</h5>
                                <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                                  {notes.map((note, index) => (
                                    <li key={`${message.id}-note-${index}`}>{note}</li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </Fragment>
                  ))}
                  {(session?.pendingToolCalls ?? [])
                    .filter(
                      (call) =>
                        !(session?.messages ?? []).some(
                          (m) =>
                            m.pendingToolCallId === call.id ||
                            m.pendingToolCallIds?.includes(call.id)
                        )
                    )
                    .map((call) => (
                      <AssistantToolCallCard
                        key={call.id}
                        call={call}
                        loading={loading}
                        onApprove={(callId) => void handleApprove(callId)}
                        onDeny={(callId) => void handleDeny(callId)}
                      />
                    ))}
                  {!session && loading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting assistant session...
                    </div>
                  )}
                  {session && loading && <AssistantTypingIndicator />}
                  <div ref={chatEndRef} />
                </div>
              </ScrollArea>

              <AssistantComposer
                input={input}
                onInputChange={setInput}
                onSend={() => void sendMessage(input)}
                onCancel={sessionId && turnCancelable ? cancelAssistantTurn : undefined}
                inputPlaceholder="Get assistance with creating or refining this scenario ..."
                snippets={SCENARIO_ASSISTANT_SNIPPETS}
                snippetsLabel="Scenario Assistant Snippets"
                onSnippetSelect={applyScenarioSnippet}
                loading={loading}
                disabled={!sessionId}
                inputRef={inputRef}
                snippetContentClassName="w-[320px]"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SuggestionCard({
  title,
  rationale,
  preview,
  applied = false,
  onApply
}: {
  title: string;
  rationale?: string;
  preview: string;
  applied?: boolean;
  onApply: () => void;
}) {
  return (
    <div
      className={`space-y-2 rounded-md border p-3 ${
        applied ? 'border-emerald-300 bg-emerald-50/40' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-sm font-medium">{title}</h5>
        <Button
          type="button"
          size="sm"
          variant={applied ? 'secondary' : 'outline'}
          onClick={onApply}
          disabled={applied}
        >
          {applied ? (
            <>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Applied
            </>
          ) : (
            'Apply'
          )}
        </Button>
      </div>
      {rationale && <p className="text-xs text-muted-foreground">{rationale}</p>}
      <pre className="max-h-56 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
        {preview}
      </pre>
    </div>
  );
}

function ScenarioAssistantMessageRow({
  message
}: {
  message: ScenarioAssistantSessionView['messages'][number];
}) {
  const copyMessageText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied' });
    } catch (error: unknown) {
      toast({
        title: 'Could not copy',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    }
  };

  const showCopyButton = message.role === 'user' || message.role === 'assistant';
  const isUser = message.role === 'user';
  return (
    <AssistantMessageRow
      message={message}
      assistantLabel={message.role === 'assistant' ? 'Assistant' : undefined}
      renderActions={
        showCopyButton ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`absolute bottom-1 h-6 w-6 text-muted-foreground ${
              isUser ? '-left-8' : '-right-8'
            }`}
            onClick={() => void copyMessageText(message.text)}
            aria-label="Copy message"
            title="Copy message"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        ) : undefined
      }
    />
  );
}
