import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Minimize2, Sparkles, Wrench, X } from 'lucide-react';
import { AssistantConversation } from '@/components/assistant/AssistantConversation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useDataSource } from '@/contexts/DataSourceContext';
import { ensureOAuthForServers } from '@/lib/oauth-session-utils';
import type { AgentConfig, Scenario, ServerConfig } from '@/types/eval';
import { createScenarioAssistantApi } from '@/lib/assistant-session-api';
import { useAssistantSession } from '@/hooks/use-assistant-session';
import { ScenarioSuggestions } from './scenario-suggestions/ScenarioSuggestions';

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
      'Propose concrete scenario updates and submit them with the local propose_scenario_changes tool so they can be applied directly.',
      'Then explain the proposal in ordinary prose.',
      'If tool usage is clear, include at least one required_tool check.',
      'For argument validation, use tool_input_contains with tool and value, tool_input_regex with tool and value, or tool_input_jsonpath with tool and path plus optional equals.',
      'Prefer deterministic checks and concise capture patterns.'
    ].join('\n')
  },
  {
    label: 'Improve Prompt Determinism',
    description: 'Reduce ambiguity and improve reproducibility.',
    prompt:
      "Identify parts of this scenario's prompt or context that are ambiguous, open-ended, or likely to produce different results across runs. Suggest specific rewrites that make the expected behavior more deterministic, without changing the intent of what is being tested."
  },
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
  const [input, setInput] = useState('');
  const [appliedSuggestionKeys, setAppliedSuggestionKeys] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const initialMessageSentRef = useRef<string | null>(null);
  const [preserveSessionOnClose, setPreserveSessionOnClose] = useState(false);
  const preserveSessionOnCloseRef = useRef(false);
  const resolvedAssistantAgentName = defaultAssistantAgentName || agents[0]?.id || '';
  const canUseAssistant =
    agents.length > 0 && scenario.serverIds.length > 0 && Boolean(resolvedAssistantAgentName);

  const createSession = useCallback(async () => {
    const selectedOauthServers = Array.from(
      new Set(
        scenario.serverIds.filter((serverId) => {
          const server = servers.find((entry) => entry.id === serverId);
          return server?.authType === 'oauth2';
        })
      )
    );
    await ensureOAuthForServers({ serverNames: selectedOauthServers, source });
    return source.createScenarioAssistantSession({
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
  }, [source, configId, configPath, scenario, agents, servers, resolvedAssistantAgentName]);
  const api = useMemo(
    () => createScenarioAssistantApi(source, createSession),
    [source, createSession]
  );
  const assistant = useAssistantSession({
    api,
    open,
    label: 'Scenario Assistant',
    autoStart: canUseAssistant
  });
  const { sessionId, session } = assistant;
  const loading = assistant.busy || assistant.starting;
  const turnCancelable = assistant.cancelable;

  const closeScenarioAssistantSession = () => {
    assistant.reset();
    setInput('');
    setAppliedSuggestionKeys(new Set());
    initialMessageSentRef.current = null;
  };

  const cancelAssistantTurn = () => {
    const prompt = assistant.cancel();
    if (prompt !== undefined) setInput(prompt);
  };

  useEffect(() => {
    if (open || !sessionId) return;
    if (preserveSessionOnCloseRef.current || preserveSessionOnClose) return;
    closeScenarioAssistantSession();
    // closeScenarioAssistantSession only touches state setters and the stable session hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, preserveSessionOnClose]);

  useEffect(() => {
    if (!open) return;
    if (preserveSessionOnClose) {
      setPreserveSessionOnClose(false);
    }
    if (preserveSessionOnCloseRef.current) {
      preserveSessionOnCloseRef.current = false;
    }
  }, [open, preserveSessionOnClose]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(40, next)}px`;
  }, [input, open]);

  const sendMessage = async (message: string) => {
    if (!sessionId) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    setInput('');
    const outcome = await assistant.send(trimmed);
    if (outcome === 'failed') setInput((previous) => (previous.trim() ? previous : trimmed));
  };

  const applyScenarioSnippet = (snippet: string) => {
    setInput(snippet);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    if (!open || !sessionId || !session) return;
    if (!canUseAssistant || assistant.busy) return;
    const handoffMessage = String(initialUserMessage ?? '').trim();
    if (!handoffMessage) return;
    if (initialMessageSentRef.current === handoffMessage) return;
    initialMessageSentRef.current = handoffMessage;
    void sendMessage(handoffMessage);
    // sendMessage is recreated each render; the guard above makes this run once per handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, session, canUseAssistant, initialUserMessage]);

  const handleApprove = (callId: string, argumentsOverride?: unknown) =>
    assistant.approve(callId, argumentsOverride);
  const handleDeny = (callId: string) => assistant.deny(callId);
  const handleApproveAll = () => assistant.approveAll?.();

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
    if (sessionId) closeScenarioAssistantSession();
  };

  const displayedMessages = assistant.messages;

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
              className="absolute right-12 top-4 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2"
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

              <AssistantConversation
                messages={displayedMessages}
                toolCalls={session?.pendingToolCalls ?? []}
                busy={assistant.busy}
                starting={assistant.starting}
                expired={assistant.expired}
                onApprove={(callId, argumentsOverride) =>
                  void handleApprove(callId, argumentsOverride)
                }
                onDeny={(callId) => void handleDeny(callId)}
                onApproveAll={assistant.approveAll ? () => void handleApproveAll() : undefined}
                notices={session?.warnings?.map((warning, index) => (
                  <div
                    key={`${warning}-${index}`}
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                  >
                    {warning}
                  </div>
                ))}
                renderMessageAddon={(message) =>
                  message.suggestions ? (
                    <ScenarioSuggestions
                      messageId={message.id}
                      suggestions={message.suggestions}
                      scenario={scenario}
                      onApplyPatch={onApplyPatch}
                      appliedKeys={appliedSuggestionKeys}
                      onApplied={(key) =>
                        setAppliedSuggestionKeys((previous) => new Set([...previous, key]))
                      }
                    />
                  ) : null
                }
                scrollClassName="rounded-md border p-3"
                composer={{
                  input,
                  onInputChange: setInput,
                  onSend: () => void sendMessage(input),
                  onCancel: sessionId && turnCancelable ? cancelAssistantTurn : undefined,
                  inputPlaceholder: 'Get assistance with creating or refining this scenario ...',
                  snippets: SCENARIO_ASSISTANT_SNIPPETS,
                  snippetsLabel: 'Scenario Assistant Snippets',
                  onSnippetSelect: applyScenarioSnippet,
                  loading,
                  disabled: !sessionId,
                  inputRef,
                  snippetContentClassName: 'w-[320px]'
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
