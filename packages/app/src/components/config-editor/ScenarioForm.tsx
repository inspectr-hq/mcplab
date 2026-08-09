import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit,
  FileText,
  Loader2,
  Paperclip,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
  XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type {
  AgentConfig,
  ScenarioAttachment,
  ServerConfig,
  Scenario,
  EvalRule
} from '@/types/eval';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';
import { formatToolSequenceLabel } from '../../../../core/src/eval';
import { ScenarioAssistantDialog } from '@/components/config-editor/ScenarioAssistantDialog';
import { RunConversationPreview } from '@/components/results/RunConversationPreview';
import { useDataSource } from '@/contexts/DataSourceContext';
import {
  isSupportedAttachmentMediaType,
  SUPPORTED_ATTACHMENT_DOCUMENT_MEDIA_TYPES,
  SUPPORTED_ATTACHMENT_IMAGE_MEDIA_TYPES
} from '@/lib/attachment-policy';
import { buildCheckItems, formatEvalRuleLabel } from '@/lib/check-presentation';
import { ensureOAuthForServers } from '@/lib/oauth-session-utils';
import { registerGlobalCopilotAction } from '@/lib/global-copilot-actions';
import {
  clearGlobalCopilotPageContext,
  globalCopilotPageContext,
  setGlobalCopilotPageContext
} from '@/lib/global-copilot-page-context';

interface ScenarioFormProps {
  scenarios: Scenario[];
  scenarioOrigins?: Array<'referenced' | 'inline'>;
  scenarioOverrides?: boolean[];
  agents: AgentConfig[];
  servers: ServerConfig[];
  configId?: string;
  configPath?: string;
  defaultAssistantAgentName?: string;
  assistantInitialPromptByScenarioId?: Record<string, string>;
  assistantAutoOpenNonceByScenarioId?: Record<string, number>;
  testCaseReturnToPath?: string;
  onChange: (scenarios: Scenario[]) => void;
  readOnly?: boolean;
  allowAdd?: boolean;
  allowStructureEdits?: boolean;
}

function RuleTypeSelect({
  value,
  onValueChange,
  className,
  hideToolSequence = false
}: {
  value: EvalRule['type'];
  onValueChange: (value: EvalRule['type']) => void;
  className?: string;
  hideToolSequence?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as EvalRule['type'])}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="required_tool">Required Tool</SelectItem>
        <SelectItem value="forbidden_tool">Forbidden Tool</SelectItem>
        {!hideToolSequence && <SelectItem value="tool_sequence">Tool Sequence</SelectItem>}
        <SelectItem value="agent_check">Judge Agent</SelectItem>
        <SelectItem value="response_contains">Text contains</SelectItem>
        <SelectItem value="response_not_contains">Text does not contain</SelectItem>
        <SelectItem value="response_starts_with">Text starts with</SelectItem>
        <SelectItem value="response_ends_with">Text ends with</SelectItem>
        <SelectItem value="response_equals">Text equals</SelectItem>
        <SelectItem value="response_regex">Text matches regex</SelectItem>
        <SelectItem value="response_jsonpath">JSONPath (optional equals)</SelectItem>
        <SelectItem value="response_jsonpath_exists">JSONPath exists</SelectItem>
        <SelectItem value="response_jsonpath_not_exists">JSONPath not exists</SelectItem>
      </SelectContent>
    </Select>
  );
}

const emptyScenario = (): Scenario => ({
  id: `scn-${Date.now()}`,
  name: '',
  serverIds: [],
  prompt: '',
  evalRules: [],
  extractRules: []
});

function formatToolSequenceText(sequence: string[]): string {
  return formatToolSequenceLabel(sequence).replace(/^Tool sequence · /, '');
}

export function ScenarioForm({
  scenarios,
  scenarioOrigins,
  scenarioOverrides,
  agents,
  servers,
  configId,
  configPath,
  defaultAssistantAgentName,
  assistantInitialPromptByScenarioId,
  assistantAutoOpenNonceByScenarioId,
  testCaseReturnToPath,
  onChange,
  readOnly,
  allowAdd = !readOnly,
  allowStructureEdits = !readOnly
}: ScenarioFormProps) {
  const update = (index: number, patch: Partial<Scenario>) => {
    const next = scenarios.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  };

  const remove = (index: number) => onChange(scenarios.filter((_, i) => i !== index));
  const add = () => onChange([...scenarios, emptyScenario()]);
  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= scenarios.length) return;
    const next = [...scenarios];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    onChange(next);
  };

  useEffect(() => {
    if (readOnly) return;
    const scenarioEditor = {
      configId,
      configPath,
      scenarios: scenarios.map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        prompt: scenario.prompt,
        serverIds: scenario.serverIds,
        evalRules: scenario.evalRules,
        extractRules: scenario.extractRules
      }))
    };
    setGlobalCopilotPageContext({
      scenarioEditor
    });
    return () => {
      if (globalCopilotPageContext().scenarioEditor === scenarioEditor) {
        clearGlobalCopilotPageContext();
      }
    };
  }, [configId, configPath, readOnly, scenarios]);

  useEffect(
    () => {
      if (readOnly) return undefined;
      return registerGlobalCopilotAction('apply_scenario_patch', async (arguments_) => {
        const scenarioId = typeof arguments_.scenarioId === 'string' ? arguments_.scenarioId : '';
        const index = scenarios.findIndex((scenario) => scenario.id === scenarioId);
        if (index < 0) throw new Error(`Scenario '${scenarioId}' is not open in the editor.`);
        const patch: Partial<Scenario> = {};
        if (typeof arguments_.prompt === 'string') patch.prompt = arguments_.prompt;
        if (Array.isArray(arguments_.evalRules)) patch.evalRules = arguments_.evalRules as EvalRule[];
        if (Array.isArray(arguments_.extractRules)) {
          patch.extractRules = arguments_.extractRules as Scenario['extractRules'];
        }
        if (Object.keys(patch).length === 0) throw new Error('No scenario changes were provided.');
        update(index, patch);
        toast({ title: 'Scenario updated', description: `Applied Copilot changes to ${scenarioId}.` });
      });
    },
    [readOnly, scenarios, onChange]
  );

  return (
    <div className={readOnly ? 'space-y-2' : 'space-y-4'}>
      {!readOnly && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Scenarios</h3>
          {allowAdd && allowStructureEdits && (
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Scenario
            </Button>
          )}
        </div>
      )}
      {scenarios.map((sc, i) => (
        <ScenarioCard
          key={sc.id}
          scenario={sc}
          scenarioOrigin={scenarioOrigins?.[i]}
          hasMcpServerOverride={scenarioOverrides?.[i]}
          index={i}
          total={scenarios.length}
          agents={agents}
          servers={servers}
          configId={configId}
          configPath={configPath}
          defaultAssistantAgentName={defaultAssistantAgentName}
          assistantInitialPrompt={assistantInitialPromptByScenarioId?.[sc.id]}
          assistantAutoOpenNonce={assistantAutoOpenNonceByScenarioId?.[sc.id]}
          testCaseReturnToPath={testCaseReturnToPath}
          onUpdate={(patch) => update(i, patch)}
          onMoveUp={() => move(i, -1)}
          onMoveDown={() => move(i, 1)}
          onRemove={() => remove(i)}
          readOnly={readOnly}
          allowStructureEdits={allowStructureEdits}
        />
      ))}
      {scenarios.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No scenarios configured. Add one to get started.
        </p>
      )}
    </div>
  );
}

function ScenarioCard({
  scenario,
  scenarioOrigin,
  hasMcpServerOverride,
  index,
  total,
  agents,
  servers,
  configId,
  configPath,
  defaultAssistantAgentName,
  assistantInitialPrompt,
  assistantAutoOpenNonce,
  testCaseReturnToPath,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onRemove,
  readOnly,
  allowStructureEdits
}: {
  scenario: Scenario;
  index: number;
  total: number;
  agents: AgentConfig[];
  servers: ServerConfig[];
  scenarioOrigin?: 'referenced' | 'inline';
  hasMcpServerOverride?: boolean;
  configId?: string;
  configPath?: string;
  defaultAssistantAgentName?: string;
  assistantInitialPrompt?: string;
  assistantAutoOpenNonce?: number;
  testCaseReturnToPath?: string;
  onUpdate: (patch: Partial<Scenario>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  readOnly?: boolean;
  allowStructureEdits?: boolean;
}) {
  const { source } = useDataSource();
  const [newRuleType, setNewRuleType] = useState<EvalRule['type']>('required_tool');
  const [newRuleValue, setNewRuleValue] = useState('');
  const [newRulePath, setNewRulePath] = useState('');
  const [newRuleEquals, setNewRuleEquals] = useState('');
  const [newRuleLabel, setNewRuleLabel] = useState('');
  const [newRulePrompt, setNewRulePrompt] = useState('');
  const [newToolSequenceValue, setNewToolSequenceValue] = useState('');
  const [toolSequenceDraft, setToolSequenceDraft] = useState<string[]>([]);
  const [toolSequenceEditorOpen, setToolSequenceEditorOpen] = useState(false);
  const [toolSequenceEditingRule, setToolSequenceEditingRule] = useState<EvalRule | null>(null);
  const [agentCheckEditingRule, setAgentCheckEditingRule] = useState<EvalRule | null>(null);
  const [agentCheckEditorOpen, setAgentCheckEditorOpen] = useState(false);
  const [valueRuleEditingRule, setValueRuleEditingRule] = useState<EvalRule | null>(null);
  const [toolPickerValue, setToolPickerValue] = useState('');
  const [availableToolNames, setAvailableToolNames] = useState<string[] | null>(null);
  const [toolNamesLoading, setToolNamesLoading] = useState(false);
  const [toolNamesError, setToolNamesError] = useState<string | null>(null);
  const [newExtractName, setNewExtractName] = useState('');
  const [newExtractPattern, setNewExtractPattern] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [previewAgentName, setPreviewAgentName] = useState<string>(
    defaultAssistantAgentName || agents[0]?.id || ''
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewAssistantPrompt, setPreviewAssistantPrompt] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleAttachmentFiles(files: FileList | null) {
    if (!files) return;
    const fileArray = Array.from(files);
    const results = new Array<ScenarioAttachment | null>(fileArray.length).fill(null);
    let completed = 0;
    let rejectedCount = 0;

    const finish = () => {
      const valid = results.filter((r): r is ScenarioAttachment => r !== null);
      if (valid.length > 0) {
        onUpdate({ attachments: [...(scenario.attachments ?? []), ...valid] });
        if (rejectedCount > 0) {
          toast({
            title: `${rejectedCount} file${rejectedCount > 1 ? 's' : ''} skipped`,
            description:
              'Unsupported file type. Images must be JPEG/PNG/GIF/WebP; documents must be PDF, TXT, MD, or CSV.',
            variant: 'destructive'
          });
        }
      } else if (fileArray.length > 0) {
        toast({
          title: 'Could not attach files',
          description:
            rejectedCount > 0
              ? 'Unsupported file type. Images must be JPEG/PNG/GIF/WebP; documents must be PDF, TXT, MD, or CSV.'
              : 'Files could not be read.',
          variant: 'destructive'
        });
      }
    };

    fileArray.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const commaIdx = dataUrl.indexOf(',');
        const data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
        if (data) {
          const header = dataUrl.slice(0, commaIdx);
          const media_type = header.replace('data:', '').replace(';base64', '');
          const isImage = media_type.startsWith('image/');
          const supported = isSupportedAttachmentMediaType(media_type);
          if (!supported) {
            rejectedCount++;
          } else {
            results[i] = {
              type: isImage ? 'image' : 'document',
              media_type,
              data,
              name: file.name
            };
          }
        }
        if (++completed === fileArray.length) finish();
      };
      reader.onerror = () => {
        if (++completed === fileArray.length) finish();
      };
      reader.readAsDataURL(file);
    });
  }

  function removeAttachment(index: number) {
    onUpdate({ attachments: (scenario.attachments ?? []).filter((_, i) => i !== index) });
  }
  const [previewResult, setPreviewResult] = useState<Awaited<
    ReturnType<typeof source.runScenarioPreview>
  > | null>(null);
  const [expanded, setExpanded] = useState(!readOnly);
  const toggleFromHeaderClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, a, input, select, textarea, [role='button']")) return;
    setExpanded((prev) => !prev);
  };

  const findRuleIndex = (rule: EvalRule | null) => {
    if (!rule) return -1;
    return scenario.evalRules.findIndex((candidate) => candidate === rule);
  };

  const addRule = () => {
    if (
      newRuleType === 'response_jsonpath' ||
      newRuleType === 'response_jsonpath_exists' ||
      newRuleType === 'response_jsonpath_not_exists'
    ) {
      const path = newRulePath.trim();
      if (!path) return;
      if (newRuleType === 'response_jsonpath') {
        const equalsText = newRuleEquals.trim();
        let equals: string | number | boolean | undefined = undefined;
        if (equalsText.length > 0) {
          if (equalsText === 'true') equals = true;
          else if (equalsText === 'false') equals = false;
          else if (!Number.isNaN(Number(equalsText))) equals = Number(equalsText);
          else equals = equalsText;
        }
        onUpdate({
          evalRules: [
            ...scenario.evalRules,
            { type: newRuleType, path, ...(equals !== undefined ? { equals } : {}) }
          ]
        });
      } else {
        onUpdate({ evalRules: [...scenario.evalRules, { type: newRuleType, path }] });
      }
      setNewRulePath('');
      setNewRuleEquals('');
      return;
    }

    if (newRuleType === 'agent_check') {
      const label = newRuleLabel.trim();
      const prompt = newRulePrompt.trim();
      if (!label || !prompt) return;
      const nextRules = [...scenario.evalRules];
      const nextRule = { type: 'agent_check', label, prompt } as const;
      const editingIndex = findRuleIndex(agentCheckEditingRule);
      if (editingIndex >= 0) nextRules[editingIndex] = nextRule;
      else nextRules.push(nextRule);
      onUpdate({ evalRules: nextRules });
      setNewRuleLabel('');
      setNewRulePrompt('');
      setAgentCheckEditingRule(null);
      setAgentCheckEditorOpen(false);
      setNewRuleType('required_tool');
      return;
    }

    if (newRuleType === 'tool_sequence') {
      const nextSequence = toolSequenceDraft
        .map((value) => value.trim())
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
      if (nextSequence.length === 0) return;
      updateToolSequence(nextSequence);
      return;
    }

    if (!newRuleValue.trim()) return;
    const nextRules = [...scenario.evalRules];
    const nextRule = { type: newRuleType, value: newRuleValue.trim() } as const;
    const editingIndex = findRuleIndex(valueRuleEditingRule);
    if (editingIndex >= 0) nextRules[editingIndex] = nextRule;
    else nextRules.push(nextRule);
    onUpdate({ evalRules: nextRules });
    setNewRuleValue('');
    setToolPickerValue('');
    setValueRuleEditingRule(null);
    setNewRuleType('required_tool');
  };

  const addToolSequenceValue = () => {
    const value = newToolSequenceValue.trim();
    if (!value) return;
    setToolSequenceDraft((current) => [...current, value]);
    setNewToolSequenceValue('');
  };

  const moveToolSequenceValue = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    setToolSequenceDraft((current) => {
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const removeToolSequenceValue = (index: number) => {
    setToolSequenceDraft((current) => current.filter((_, i) => i !== index));
  };

  const toolSequenceRuleIndex = scenario.evalRules.findIndex(
    (rule) => rule.type === 'tool_sequence'
  );
  const toolSequenceRule =
    toolSequenceRuleIndex >= 0 ? scenario.evalRules[toolSequenceRuleIndex] : undefined;
  const toolSequence =
    toolSequenceRule?.type === 'tool_sequence' ? toolSequenceRule.sequence ?? [] : [];
  const hasToolSequenceRule = toolSequenceRuleIndex >= 0;

  const updateToolSequence = (nextSequence: string[]) => {
    const nextRules = [...scenario.evalRules];
    const nextRule =
      nextSequence.length > 0 ? ({ type: 'tool_sequence', sequence: nextSequence } as const) : null;
    const editingIndex = findRuleIndex(toolSequenceEditingRule);
    const currentIndex = editingIndex >= 0 ? editingIndex : toolSequenceRuleIndex;
    if (currentIndex >= 0) {
      if (nextRule) nextRules[currentIndex] = nextRule;
      else nextRules.splice(currentIndex, 1);
    } else if (nextRule) {
      nextRules.push(nextRule);
    }
    onUpdate({ evalRules: nextRules });
    setToolSequenceEditorOpen(false);
    setToolSequenceDraft([]);
    setNewToolSequenceValue('');
    setToolSequenceEditingRule(null);
    if (newRuleType === 'tool_sequence') {
      setNewRuleType('required_tool');
    }
  };

  useEffect(() => {
    if (!toolSequenceEditorOpen) return;
    setToolSequenceDraft(toolSequence);
  }, [toolSequenceEditorOpen, toolSequenceRuleIndex, toolSequence.join('|')]);

  useEffect(() => {
    setToolSequenceEditorOpen(newRuleType === 'tool_sequence');
  }, [newRuleType]);

  useEffect(() => {
    setAgentCheckEditorOpen(newRuleType === 'agent_check');
  }, [newRuleType]);

  useEffect(() => {
    if (toolSequenceEditingRule && findRuleIndex(toolSequenceEditingRule) < 0) {
      setToolSequenceEditingRule(null);
    }
    if (agentCheckEditingRule && findRuleIndex(agentCheckEditingRule) < 0) {
      setAgentCheckEditingRule(null);
    }
    if (valueRuleEditingRule && findRuleIndex(valueRuleEditingRule) < 0) {
      setValueRuleEditingRule(null);
    }
  }, [scenario.evalRules, toolSequenceEditingRule, agentCheckEditingRule, valueRuleEditingRule]);

  useEffect(() => {
    if (toolSequenceEditingRule && newRuleType !== 'tool_sequence') {
      setToolSequenceEditingRule(null);
    }
    if (agentCheckEditingRule && newRuleType !== 'agent_check') {
      setAgentCheckEditingRule(null);
    }
    if (valueRuleEditingRule && valueRuleEditingRule.type !== newRuleType) {
      setValueRuleEditingRule(null);
    }
  }, [newRuleType, toolSequenceEditingRule, agentCheckEditingRule, valueRuleEditingRule]);

  const removeRule = (ri: number) => {
    const nextRules = scenario.evalRules.filter((_, i) => i !== ri);
    const hasAgentChecks = nextRules.some((r) => r.type === 'agent_check');
    onUpdate({
      evalRules: nextRules,
      agentContext: hasAgentChecks ? scenario.agentContext : undefined
    });
  };

  const editableValueRuleTypes: EvalRule['type'][] = [
    'response_contains',
    'response_not_contains',
    'response_starts_with',
    'response_ends_with',
    'response_equals',
    'response_regex'
  ];

  const addExtract = () => {
    if (!newExtractName.trim() || !newExtractPattern.trim()) return;
    onUpdate({
      extractRules: [
        ...scenario.extractRules,
        { name: newExtractName.trim(), pattern: newExtractPattern.trim() }
      ]
    });
    setNewExtractName('');
    setNewExtractPattern('');
  };

  const removeExtract = (ri: number) => {
    onUpdate({ extractRules: scenario.extractRules.filter((_, i) => i !== ri) });
  };

  const toggleServer = (srvId: string) => {
    const next = scenario.serverIds.includes(srvId)
      ? scenario.serverIds.filter((id) => id !== srvId)
      : [...scenario.serverIds, srvId];
    onUpdate({ serverIds: next });
  };

  const ruleTypeLabel: Record<EvalRule['type'], string> = {
    required_tool: 'Required',
    forbidden_tool: 'Forbidden',
    tool_sequence: 'Sequence',
    response_contains: 'Contains',
    response_not_contains: 'Not Contains',
    response_starts_with: 'Starts With',
    response_ends_with: 'Ends With',
    response_equals: 'Equals',
    response_regex: 'Regex',
    response_jsonpath: 'JSONPath',
    response_jsonpath_exists: 'JSONPath Exists',
    response_jsonpath_not_exists: 'JSONPath Not Exists',
    agent_check: 'Agent'
  };

  const ruleTypeBadgeColor: Record<EvalRule['type'], string> = {
    required_tool: 'border-sky-300/60 bg-sky-500/10 text-sky-700',
    forbidden_tool: 'border-rose-300/60 bg-rose-500/10 text-rose-700',
    tool_sequence: 'border-teal-300/60 bg-teal-500/10 text-teal-700',
    response_contains: 'border-violet-300/60 bg-violet-500/10 text-violet-700',
    response_not_contains: 'border-amber-300/60 bg-amber-500/10 text-amber-700',
    response_starts_with: 'border-cyan-300/60 bg-cyan-500/10 text-cyan-700',
    response_ends_with: 'border-indigo-300/60 bg-indigo-500/10 text-indigo-700',
    response_equals: 'border-lime-300/60 bg-lime-500/10 text-lime-700',
    response_regex: 'border-fuchsia-300/60 bg-fuchsia-500/10 text-fuchsia-700',
    response_jsonpath: 'border-emerald-300/60 bg-emerald-500/10 text-emerald-700',
    response_jsonpath_exists: 'border-green-300/60 bg-green-500/10 text-green-700',
    response_jsonpath_not_exists: 'border-orange-300/60 bg-orange-500/10 text-orange-700',
    agent_check: 'border-teal-300/60 bg-teal-500/10 text-teal-700'
  };
  const isToolRule = newRuleType === 'required_tool' || newRuleType === 'forbidden_tool';
  const isJsonPathRule =
    newRuleType === 'response_jsonpath' ||
    newRuleType === 'response_jsonpath_exists' ||
    newRuleType === 'response_jsonpath_not_exists';
  const showToolSequenceEditor = newRuleType === 'tool_sequence' && toolSequenceEditorOpen;
  const showAgentCheckEditor = newRuleType === 'agent_check' && agentCheckEditorOpen;
  const selectedServerIds = scenario.serverIds.filter((sid) =>
    servers.some((srv) => srv.id === sid)
  );
  const availableAgentIds = agents.map((agent) => agent.id).filter(Boolean);
  const canLoadToolNames = selectedServerIds.length > 0;
  const [consumedInitialPrompt, setConsumedInitialPrompt] = useState<string>('');
  const [consumedAutoOpenNonce, setConsumedAutoOpenNonce] = useState<number>(0);

  useEffect(() => {
    const handoff = (assistantInitialPrompt ?? '').trim();
    if (!handoff) return;
    if (consumedInitialPrompt === handoff) return;
    setAssistantOpen(true);
    setConsumedInitialPrompt(handoff);
  }, [assistantInitialPrompt, consumedInitialPrompt]);

  useEffect(() => {
    if (!assistantAutoOpenNonce) return;
    if (assistantAutoOpenNonce === consumedAutoOpenNonce) return;
    setAssistantOpen(true);
    setConsumedAutoOpenNonce(assistantAutoOpenNonce);
  }, [assistantAutoOpenNonce, consumedAutoOpenNonce]);

  useEffect(() => {
    setAvailableToolNames(null);
    setToolNamesError(null);
    setToolPickerValue('');
  }, [scenario.serverIds.join('|')]);

  useEffect(() => {
    setToolPickerValue('');
    setNewRulePath('');
    setNewRuleEquals('');
    setNewToolSequenceValue('');
  }, [newRuleType]);

  useEffect(() => {
    if (previewAgentName && availableAgentIds.includes(previewAgentName)) return;
    setPreviewAgentName(defaultAssistantAgentName || agents[0]?.id || '');
  }, [previewAgentName, defaultAssistantAgentName, agents, availableAgentIds]);

  const runPromptPreview = async () => {
    if (!previewAgentName) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const oauthServerIds = scenario.serverIds.filter((serverId) => {
        const server = servers.find((entry) => entry.id === serverId);
        return server?.authType === 'oauth2';
      });
      await ensureOAuthForServers({ serverNames: oauthServerIds, source });

      const preview = await source.runScenarioPreview({
        selectedAgentName: previewAgentName,
        scenario: {
          id: scenario.id,
          name: scenario.name,
          prompt: scenario.prompt,
          serverNames: scenario.serverIds,
          attachments: scenario.attachments ?? [],
          evalRules: scenario.evalRules,
          extractRules: scenario.extractRules
        }
      });
      setPreviewResult(preview);
    } catch (error: unknown) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  const sendPreviewToAssistant = () => {
    if (!previewResult) return;
    const checkItems = buildPreviewCheckItems(
      scenario.evalRules,
      previewResult.run.failureReasons,
      previewResult.run.checkResults
    );
    const checkSummary = checkItems.length
      ? checkItems
          .map(
            (item) =>
              `${item.status.toUpperCase()} - ${renderEvalRulePreview(item.rule)}${
                item.failureReason ? ` (${item.failureReason})` : ''
              }`
          )
          .join('\n')
      : 'No checks configured.';
    const extractedSummary =
      Object.keys(previewResult.run.extractedValues).length > 0
        ? Object.entries(previewResult.run.extractedValues)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join('\n')
        : 'No extracted values.';
    const toolSummary =
      previewResult.run.toolCalls.length > 0
        ? previewResult.run.toolCalls
            .map((call, idx) => `${idx + 1}. ${call.name} (${call.duration}ms)`)
            .join('\n')
        : 'No tool calls.';
    const prompt = [
      `I ran a prompt preview for scenario '${scenario.id}' and want you to suggest concrete updates.`,
      `Run ID: ${previewResult.runId}`,
      `Agent: ${previewResult.agentName}`,
      `Outcome: ${previewResult.run.passed ? 'passed' : 'failed'}`,
      `Duration: ${previewResult.run.duration}ms`,
      '',
      'Current check outcomes:',
      checkSummary,
      '',
      'Tool sequence:',
      toolSummary,
      '',
      'Extracted values:',
      extractedSummary,
      '',
      'Final answer:',
      previewResult.run.finalAnswer || '(empty)',
      '',
      'If the run has a meaningful ordered tool path, suggest a tool_sequence check using the raw tool names in the tool sequence order, even if other tools appear between them.',
      'Use agent_check only for semantic or fuzzy validation;',
      'Please propose concrete updates to the Prompt, Checks, and/or Value Capture Rules based on this preview.'
    ].join('\n');
    setPreviewAssistantPrompt(prompt);
    setAssistantOpen(true);
  };

  const loadAvailableTools = async () => {
    if (!canLoadToolNames || readOnly) return;
    setToolNamesLoading(true);
    setToolNamesError(null);
    try {
      const oauthServerIds = selectedServerIds.filter((serverId) => {
        const server = servers.find((entry) => entry.id === serverId);
        return server?.authType === 'oauth2';
      });
      await ensureOAuthForServers({ serverNames: oauthServerIds, source });

      const discovered = new Set<string>();
      for (const serverId of selectedServerIds) {
        const res = await source.discoverToolsForAnalysis({ serverNames: [serverId] });
        for (const server of res.servers) {
          for (const tool of server.tools) discovered.add(tool.name);
        }
      }
      setAvailableToolNames(Array.from(discovered).sort((a, b) => a.localeCompare(b)));
    } catch (err) {
      setToolNamesError(err instanceof Error ? err.message : 'Failed to load tools');
    } finally {
      setToolNamesLoading(false);
    }
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className={readOnly ? 'rounded-md border shadow-none' : 'border-dashed'}>
        <CardHeader
          className={`${
            readOnly ? 'px-3 py-3' : 'pb-3'
          } flex-row items-center justify-between space-y-0 cursor-pointer`}
          onClick={toggleFromHeaderClick}
        >
          <div className="flex min-w-0 items-center gap-2">
            {!readOnly && (
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7">
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      expanded ? 'rotate-0' : '-rotate-90'
                    }`}
                  />
                </Button>
              </CollapsibleTrigger>
            )}
            <span className="text-xs text-muted-foreground">{index + 1}.</span>
            <CardTitle className="truncate text-sm font-medium">
              {scenario.name || `Scenario ${index + 1}`}
            </CardTitle>
            {readOnly && scenarioOrigin === 'referenced' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                asChild
              >
                <Link
                  to={`/libraries/test-cases/${encodeURIComponent(scenario.id)}${
                    testCaseReturnToPath
                      ? `?returnTo=${encodeURIComponent(testCaseReturnToPath)}`
                      : ''
                  }`}
                >
                  Edit test
                </Link>
              </Button>
            )}
          </div>
          {readOnly ? (
            <div className="flex items-center gap-2">
              {scenarioOrigin && (
                <Badge variant={scenarioOrigin === 'inline' ? 'secondary' : 'outline'}>
                  {scenarioOrigin === 'referenced' ? 'Referenced' : 'Inline'}
                </Badge>
              )}
              {hasMcpServerOverride && <Badge variant="secondary">Override</Badge>}
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  aria-label={expanded ? 'Collapse scenario details' : 'Expand scenario details'}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
          ) : (
            allowStructureEdits && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => setAssistantOpen(true)}
                  title={
                    agents.length === 0
                      ? 'Add at least one agent in the config'
                      : scenario.serverIds.length === 0
                      ? 'Select at least one server for this scenario'
                      : 'Open Scenario Assistant'
                  }
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  Ask Assistant
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onMoveUp}
                  disabled={index === 0}
                  aria-label="Move scenario up"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onMoveDown}
                  disabled={index === total - 1}
                  aria-label="Move scenario down"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onRemove}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            )
          )}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <ScenarioAssistantDialog
              open={assistantOpen}
              onOpenChange={(nextOpen) => {
                setAssistantOpen(nextOpen);
                if (!nextOpen) setPreviewAssistantPrompt('');
              }}
              configId={configId}
              configPath={configPath}
              scenario={scenario}
              agents={agents}
              servers={servers}
              defaultAssistantAgentName={defaultAssistantAgentName}
              initialUserMessage={previewAssistantPrompt || assistantInitialPrompt}
              onApplyPatch={(patch) =>
                onUpdate({
                  ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
                  ...(patch.evalRules !== undefined ? { evalRules: patch.evalRules } : {}),
                  ...(patch.extractRules !== undefined ? { extractRules: patch.extractRules } : {})
                })
              }
            />
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={scenario.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                disabled={readOnly}
                placeholder="e.g. List directory"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Servers</Label>
              <div className="flex flex-wrap gap-1.5">
                {servers.map((srv) => (
                  <Badge
                    key={srv.id}
                    variant={scenario.serverIds.includes(srv.id) ? 'default' : 'outline'}
                    className={`cursor-pointer text-xs ${
                      scenario.serverIds.includes(srv.id) ? '' : 'opacity-50'
                    }`}
                    onClick={() => !readOnly && toggleServer(srv.id)}
                  >
                    {srv.name || srv.id}
                  </Badge>
                ))}
                {servers.length === 0 && (
                  <span className="text-xs text-muted-foreground">Add servers above first</span>
                )}
              </div>
            </div>

            <Card className="border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Prompt</CardTitle>
                <p className="text-xs text-muted-foreground">
                  The instruction sent to the agent for this scenario. Be explicit about the task,
                  expected output, and constraints.
                </p>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <Textarea
                  value={scenario.prompt}
                  onChange={(e) => onUpdate({ prompt: e.target.value })}
                  disabled={readOnly}
                  placeholder="The prompt to send to the agent..."
                  rows={4}
                  className="text-xs"
                />
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={[
                      ...SUPPORTED_ATTACHMENT_IMAGE_MEDIA_TYPES,
                      ...SUPPORTED_ATTACHMENT_DOCUMENT_MEDIA_TYPES,
                      '.md'
                    ].join(',')}
                    multiple
                    className="hidden"
                    onChange={(e) => handleAttachmentFiles(e.target.files)}
                  />
                  {(scenario.attachments?.length ?? 0) > 0 ? (
                    <div className="flex flex-wrap items-start gap-2">
                      {scenario.attachments?.map((att, ai) => (
                        <div
                          key={ai}
                          className="group relative"
                          title={`${att.name ?? `attachment ${ai + 1}`}`}
                        >
                          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded border bg-muted">
                            {att.type === 'image' ? (
                              <img
                                src={`data:${att.media_type};base64,${att.data}`}
                                alt={att.name ?? `attachment ${ai + 1}`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <FileText className="h-6 w-6 text-muted-foreground" />
                            )}
                          </div>
                          {att.name && (
                            <p className="mt-0.5 max-w-[64px] truncate text-center text-xs text-muted-foreground">
                              {att.name}
                            </p>
                          )}
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => removeAttachment(ai)}
                              className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground group-hover:flex"
                              aria-label="Remove attachment"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </div>
                      ))}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="flex h-16 w-16 items-center justify-center self-start rounded border border-dashed text-muted-foreground hover:border-foreground hover:text-foreground"
                          aria-label="Attach file"
                          title="Attach file (image or document)"
                        >
                          <Paperclip className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ) : (
                    !readOnly && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        Attach file
                      </button>
                    )
                  )}
                </div>
              </CardContent>
            </Card>

            {!readOnly && (
              <Card className="border bg-muted/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Run Prompt Preview</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Execute the current draft prompt once and inspect final answer, conversation
                    trace, tool calls, and check outcomes.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-1">
                      <Label className="text-xs">Agent</Label>
                      <Select value={previewAgentName} onValueChange={setPreviewAgentName}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select agent" />
                        </SelectTrigger>
                        <SelectContent>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name || agent.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 px-2 text-xs"
                        onClick={() => void runPromptPreview()}
                        disabled={
                          previewLoading ||
                          !previewAgentName ||
                          !scenario.prompt.trim() ||
                          scenario.serverIds.length === 0
                        }
                      >
                        {previewLoading ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Running...
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5" />
                            Run Prompt
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  {!scenario.prompt.trim() && (
                    <p className="text-[11px] text-muted-foreground">
                      Add a prompt to run preview.
                    </p>
                  )}
                  {scenario.serverIds.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Select at least one server to run preview.
                    </p>
                  )}
                  {previewError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {previewError}
                    </div>
                  )}
                  {previewResult && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant={previewResult.run.passed ? 'default' : 'destructive'}>
                          {previewResult.run.passed ? 'Passed' : 'Failed'}
                        </Badge>
                        <Badge variant="outline">{previewResult.run.duration}ms</Badge>
                        <Badge variant="outline">
                          {previewResult.run.toolCalls.length} tool calls
                        </Badge>
                        <Badge variant="outline" className="font-mono">
                          {previewResult.agentName}
                        </Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="ml-auto h-6 gap-1.5 px-2 text-[11px]"
                          onClick={sendPreviewToAssistant}
                        >
                          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                          Send to Assistant
                        </Button>
                      </div>
                      {scenario.evalRules.length === 0 ? (
                        <div className="rounded-md border bg-muted/20 p-2">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Check results
                          </p>
                          <p className="text-xs text-muted-foreground">
                            No checks configured for this scenario.
                          </p>
                        </div>
                      ) : (
                        (() => {
                          const checks = buildPreviewCheckItems(
                            scenario.evalRules,
                            previewResult.run.failureReasons,
                            previewResult.run.checkResults
                          );
                          const passedChecks = checks.filter((check) => check.status === 'passed');
                          const failedChecks = checks.filter((check) => check.status === 'failed');
                          return (
                            <div className="rounded-md border bg-muted/20 p-2">
                              <div className="mb-2 flex items-center gap-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Checks
                                </p>
                                <Badge
                                  variant="outline"
                                  className="h-5 border-success/30 bg-success/10 text-success text-[10px]"
                                >
                                  {passedChecks.length} passed
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`h-5 text-[10px] ${
                                    failedChecks.length > 0
                                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                                      : ''
                                  }`}
                                >
                                  {failedChecks.length} failed
                                </Badge>
                              </div>
                              <div className="space-y-1">
                                {checks.map((check, idx) => (
                                  <div
                                    key={`${scenario.id}-preview-check-${idx}`}
                                    className={`flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${
                                      check.status === 'failed'
                                        ? 'border-destructive/20 bg-destructive/5'
                                        : 'border-success/20 bg-success/5'
                                    }`}
                                  >
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        {check.status === 'failed' ? (
                                          <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                                        ) : (
                                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                                        )}
                                        <span className="font-medium">
                                          {formatPreviewEvalRuleLabel(check.rule)}
                                        </span>
                                      </div>
                                      {check.failureReason && (
                                        <p className="mt-1 pl-5 text-[11px] text-muted-foreground">
                                          {formatPreviewFailureReason(check.failureReason)}
                                        </p>
                                      )}
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className={`shrink-0 text-[10px] ${
                                        check.status === 'failed'
                                          ? 'border-destructive/30 text-destructive'
                                          : 'border-success/30 text-success'
                                      }`}
                                    >
                                      {check.status}
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()
                      )}
                      {previewResult.run.failureReasons.length > 0 && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
                            Check failures
                          </p>
                          <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
                            {previewResult.run.failureReasons.map((reason, idx) => (
                              <li key={`${previewResult.runId}-failure-${idx}`}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {Object.keys(previewResult.run.extractedValues).length > 0 && (
                        <div className="rounded-md border bg-background p-2">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Extracted values
                          </p>
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {Object.entries(previewResult.run.extractedValues).map(
                              ([key, value]) => (
                                <div
                                  key={key}
                                  className="rounded border bg-muted/20 px-2 py-1 text-xs"
                                >
                                  <div className="font-mono text-[11px] text-muted-foreground">
                                    {key}
                                  </div>
                                  <div className="break-all">{String(value)}</div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}
                      <RunConversationPreview
                        run={previewResult.run}
                        fallbackUserPrompt={scenario.prompt}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <Card className="border bg-muted/20">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-sm">Checks</CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Checks determine pass/fail for the scenario. Add tool checks or text pattern
                        checks for the final answer.
                      </p>
                    </div>
                    {!readOnly && (
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-xs shrink-0"
                          onClick={() => setAssistantOpen(true)}
                          title="Ask for help improving checks"
                        >
                          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                          Ask Assistant
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="space-y-2">
                    <Label className="text-xs">Checks (pass / fail)</Label>
                    <p className="text-[11px] text-muted-foreground">
                      These determine whether the scenario passes. Add tool checks
                      (required/forbidden) or text pattern checks for the final answer.
                    </p>
                    <div className="space-y-1.5">
                      {scenario.evalRules.length === 0 ? (
                        <p className="rounded-md border border-dashed bg-background/60 px-2 py-2 text-xs text-muted-foreground">
                          No checks yet. Add tool checks or text pattern checks below.
                        </p>
                      ) : (
                        scenario.evalRules.map((rule, ri) => (
                          <div
                            key={ri}
                            className="flex items-start justify-between gap-2 rounded-md border bg-background px-2 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                    ruleTypeBadgeColor[rule.type]
                                  }`}
                                >
                                  {ruleTypeLabel[rule.type]}
                                </span>
                                {rule.type === 'agent_check' ? (
                                  <div className="min-w-0">
                                    <div className="font-medium leading-tight">
                                      {rule.label || 'Unnamed check'}
                                    </div>
                                    {rule.prompt && (
                                      <div className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">
                                        {rule.prompt}
                                      </div>
                                    )}
                                  </div>
                                ) : rule.type === 'tool_sequence' ? (
                                  <span className="font-mono break-all">
                                    {formatToolSequenceText(rule.sequence ?? [])}
                                  </span>
                                ) : (
                                  <span className="font-mono break-all">
                                    {rule.path
                                      ? rule.equals !== undefined
                                        ? `${rule.path} == ${String(rule.equals)}`
                                        : rule.path
                                      : rule.value}
                                  </span>
                                )}
                              </div>
                            </div>
                            {!readOnly && (
                              <div className="flex items-center gap-1">
                                {(rule.type === 'tool_sequence' ||
                                  rule.type === 'agent_check' ||
                                  editableValueRuleTypes.includes(rule.type)) && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[11px]"
                                    onClick={() => {
                                      if (rule.type === 'tool_sequence') {
                                        setNewRuleType('tool_sequence');
                                        setToolSequenceDraft(rule.sequence ?? []);
                                        setToolSequenceEditingRule(rule);
                                        setToolSequenceEditorOpen(true);
                                        return;
                                      }
                                      if (rule.type === 'agent_check') {
                                        setNewRuleType('agent_check');
                                        setAgentCheckEditingRule(rule);
                                        setNewRuleLabel(rule.label ?? '');
                                        setNewRulePrompt(rule.prompt ?? '');
                                        setAgentCheckEditorOpen(true);
                                        return;
                                      }
                                      setNewRuleType(rule.type);
                                      setValueRuleEditingRule(rule);
                                      setNewRuleValue(rule.value ?? '');
                                    }}
                                    aria-label={`Edit check ${ri + 1}`}
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() => removeRule(ri)}
                                  aria-label={`Remove check ${ri + 1}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                    {!readOnly && (
                      <div className="space-y-2">
                        {showAgentCheckEditor ? (
                          <div className="space-y-2">
                            <div className="flex items-end gap-2">
                              <RuleTypeSelect
                                value={newRuleType}
                                onValueChange={setNewRuleType}
                                className="h-8 w-[14.5rem] shrink-0 text-xs"
                              />
                              <Input
                                value={newRuleLabel}
                                onChange={(e) => setNewRuleLabel(e.target.value)}
                                placeholder="Prompt name"
                                className="h-8 text-xs"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 shrink-0"
                                onClick={addRule}
                              >
                                {agentCheckEditingRule !== null ? 'Update check' : 'Add check'}
                              </Button>
                            </div>
                            <Textarea
                              value={newRulePrompt}
                              onChange={(e) => setNewRulePrompt(e.target.value)}
                              placeholder="Judge prompt. Example: Confirm the answer includes a valid earliest and latest timestamp range, and that neither is 'Not available'."
                              className="min-h-[64px] text-xs"
                            />
                          </div>
                        ) : (
                          <div className="flex gap-2 items-end">
                            <RuleTypeSelect
                              value={newRuleType}
                              onValueChange={setNewRuleType}
                              className="h-8 w-[14.5rem] shrink-0 text-xs"
                              hideToolSequence={
                                hasToolSequenceRule && newRuleType !== 'tool_sequence'
                              }
                            />
                            {isJsonPathRule ? (
                              <>
                                <Input
                                  value={newRulePath}
                                  onChange={(e) => setNewRulePath(e.target.value)}
                                  placeholder="JSONPath (e.g. $.status)"
                                  className="h-8 text-xs font-mono"
                                  onKeyDown={(e) =>
                                    e.key === 'Enter' && (e.preventDefault(), addRule())
                                  }
                                />
                                {newRuleType === 'response_jsonpath' && (
                                  <Input
                                    value={newRuleEquals}
                                    onChange={(e) => setNewRuleEquals(e.target.value)}
                                    placeholder="Equals (optional)"
                                    className="h-8 w-[12rem] text-xs font-mono"
                                    onKeyDown={(e) =>
                                      e.key === 'Enter' && (e.preventDefault(), addRule())
                                    }
                                  />
                                )}
                              </>
                            ) : showToolSequenceEditor ? (
                              <div className="min-w-0 flex-1 flex items-end gap-2">
                                <Input
                                  value={newToolSequenceValue}
                                  onChange={(e) => setNewToolSequenceValue(e.target.value)}
                                  placeholder="Tool name"
                                  className="h-8 text-xs font-mono"
                                  onKeyDown={(e) =>
                                    e.key === 'Enter' &&
                                    (e.preventDefault(), addToolSequenceValue())
                                  }
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 shrink-0"
                                  onClick={addToolSequenceValue}
                                >
                                  Add step
                                </Button>
                              </div>
                            ) : (
                              <Input
                                value={newRuleValue}
                                onChange={(e) => setNewRuleValue(e.target.value)}
                                placeholder="Value"
                                className="h-8 text-xs font-mono"
                                onKeyDown={(e) =>
                                  e.key === 'Enter' && (e.preventDefault(), addRule())
                                }
                              />
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 shrink-0"
                              onClick={addRule}
                            >
                              {valueRuleEditingRule !== null ? 'Update check' : 'Add'}
                            </Button>
                          </div>
                        )}
                        {showToolSequenceEditor && (
                          <div className="space-y-2 rounded-md border bg-background px-2 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <Label className="text-xs">Sequence steps</Label>
                                <p className="text-[11px] text-muted-foreground">
                                  Require these tools in order. Other tools may appear between them.
                                </p>
                              </div>
                              {!readOnly && toolSequenceDraft.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => setToolSequenceDraft([])}
                                  >
                                    Clear
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => updateToolSequence(toolSequenceDraft)}
                                  >
                                    {hasToolSequenceRule ? 'Update sequence' : 'Add sequence'}
                                  </Button>
                                </div>
                              )}
                            </div>
                            {toolSequenceDraft.length === 0 ? (
                              <p className="rounded-md border border-dashed bg-muted/20 px-2 py-2 text-xs text-muted-foreground">
                                No ordered tool sequence yet.
                              </p>
                            ) : (
                              <div className="space-y-1.5">
                                {toolSequenceDraft.map((toolName, toolIndex) => (
                                  <div
                                    key={`${scenario.id}-tool-sequence-draft-${toolIndex}`}
                                    className="flex items-center gap-2 rounded-md border bg-muted/10 px-2 py-1.5"
                                  >
                                    <span className="text-xs font-medium">{toolIndex + 1}.</span>
                                    <span className="min-w-0 flex-1 font-mono text-xs break-all">
                                      {toolName}
                                    </span>
                                    {!readOnly && (
                                      <div className="flex items-center gap-1">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={() => moveToolSequenceValue(toolIndex, -1)}
                                          disabled={toolIndex === 0}
                                          aria-label={`Move tool ${toolIndex + 1} up`}
                                        >
                                          <ChevronUp className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={() => moveToolSequenceValue(toolIndex, 1)}
                                          disabled={toolIndex === toolSequenceDraft.length - 1}
                                          aria-label={`Move tool ${toolIndex + 1} down`}
                                        >
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={() => removeToolSequenceValue(toolIndex)}
                                          aria-label={`Remove tool ${toolIndex + 1}`}
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {isToolRule && (
                          <div className="space-y-1">
                            <div className="flex items-end gap-2">
                              <div className="min-w-0 flex-1">
                                <Label className="mb-1 block text-[11px] text-muted-foreground">
                                  Pick from selected server tools (optional)
                                </Label>
                                <Select
                                  value={toolPickerValue}
                                  onValueChange={(value) => {
                                    setToolPickerValue(value);
                                    setNewRuleValue(value);
                                  }}
                                  disabled={
                                    toolNamesLoading ||
                                    !availableToolNames ||
                                    availableToolNames.length === 0
                                  }
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue
                                      placeholder={
                                        toolNamesLoading
                                          ? 'Loading tools...'
                                          : availableToolNames && availableToolNames.length > 0
                                          ? 'Select tool to insert in value field'
                                          : 'Load tools first'
                                      }
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(availableToolNames ?? []).map((toolName) => (
                                      <SelectItem key={toolName} value={toolName}>
                                        {toolName}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 shrink-0"
                                onClick={loadAvailableTools}
                                disabled={!canLoadToolNames || toolNamesLoading}
                              >
                                {toolNamesLoading
                                  ? 'Loading...'
                                  : availableToolNames
                                  ? 'Refresh tools'
                                  : 'Load tools'}
                              </Button>
                            </div>
                            {!canLoadToolNames && (
                              <p className="text-[11px] text-muted-foreground">
                                Select at least one server in this scenario to load tool names.
                              </p>
                            )}
                            {toolNamesError && (
                              <p className="text-[11px] text-destructive">
                                Could not load tools: {toolNamesError}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border bg-muted/10">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-sm">Value Capture Rules</CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Formerly “Extract Rules”. These do not fail the run. They capture structured
                        values from the final answer for reporting and comparisons.
                      </p>
                    </div>
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-xs shrink-0"
                        onClick={() => setAssistantOpen(true)}
                        title="Ask for help improving value capture rules"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        Ask Assistant
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="space-y-2">
                    <Label className="text-xs">Value Capture Rules</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Use regex patterns to capture values like max concentration, product names,
                      date ranges, or IDs from the final answer text.
                    </p>
                    <div className="space-y-1.5">
                      {scenario.extractRules.length === 0 ? (
                        <p className="w-full rounded-md border border-dashed bg-background/60 px-2 py-2 text-xs text-muted-foreground">
                          No value capture rules yet. Add one below to capture structured output
                          from the final answer.
                        </p>
                      ) : (
                        scenario.extractRules.map((rule, ri) => (
                          <div
                            key={ri}
                            className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="rounded-full border border-violet-300/60 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                                  {rule.name}
                                </span>
                                <span className="text-[11px] font-semibold text-muted-foreground">
                                  regex:
                                </span>
                                <code className="font-mono break-all text-foreground">
                                  {rule.pattern}
                                </code>
                              </div>
                            </div>
                            {!readOnly && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0"
                                onClick={() => removeExtract(ri)}
                                aria-label={`Remove value capture rule ${ri + 1}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                    {!readOnly && (
                      <div className="flex gap-2 items-end">
                        <Input
                          value={newExtractName}
                          onChange={(e) => setNewExtractName(e.target.value)}
                          placeholder="Field name"
                          className="h-8 text-xs w-36"
                        />
                        <Input
                          value={newExtractPattern}
                          onChange={(e) => setNewExtractPattern(e.target.value)}
                          placeholder="Regex pattern"
                          className="h-8 text-xs font-mono"
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addExtract())}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0"
                          onClick={addExtract}
                        >
                          Add
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
            {scenario.evalRules.some((r) => r.type === 'agent_check') && (
              <Card className="border bg-muted/10">
                <CardHeader className="pb-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm">Judge context</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Extra context is shared across all judge checks in this scenario and sent once
                      in the batched judge request.
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={`judge-ctx-prompt-${scenario.id}`}
                      checked={scenario.agentContext?.include_prompt ?? false}
                      disabled={readOnly}
                      className="mt-0.5"
                      onCheckedChange={(checked) => {
                        onUpdate({
                          agentContext: {
                            ...scenario.agentContext,
                            include_prompt: checked === true
                          }
                        });
                      }}
                    />
                    <div>
                      <Label
                        htmlFor={`judge-ctx-prompt-${scenario.id}`}
                        className="cursor-pointer text-xs font-medium"
                      >
                        Include prompt
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Sends the scenario prompt so the judge can verify the answer addresses the
                        original question.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={`judge-ctx-tools-${scenario.id}`}
                      checked={scenario.agentContext?.include_tool_sequence ?? false}
                      disabled={readOnly}
                      className="mt-0.5"
                      onCheckedChange={(checked) => {
                        onUpdate({
                          agentContext: {
                            ...scenario.agentContext,
                            include_tool_sequence: checked === true
                          }
                        });
                      }}
                    />
                    <div>
                      <Label
                        htmlFor={`judge-ctx-tools-${scenario.id}`}
                        className="cursor-pointer text-xs font-medium"
                      >
                        Include tool sequence
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Sends the list of called tool names so the judge can reason about which
                        tools were used.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function buildPreviewCheckItems(
  evalRules: EvalRule[],
  failureReasons: string[],
  checkResults?: Array<{
    type: string;
    label: string;
    status: 'passed' | 'failed' | 'not_evaluated';
    reason?: string;
  }>
) {
  return buildCheckItems({ evalRules, failureReasons, checkResults });
}

function renderEvalRulePreview(rule: EvalRule): string {
  if (rule.type === 'agent_check') {
    return `${rule.type}: ${rule.label ?? ''} — ${rule.prompt ?? ''}`;
  }
  if (rule.type === 'tool_sequence') {
    return `${rule.type}: ${formatToolSequenceText(rule.sequence ?? [])}`;
  }
  if (rule.path) {
    return rule.equals !== undefined
      ? `${rule.type}: ${rule.path} == ${String(rule.equals)}`
      : `${rule.type}: ${rule.path}`;
  }
  return `${rule.type}: ${rule.value ?? ''}`;
}

const formatPreviewEvalRuleLabel = formatEvalRuleLabel;

function formatPreviewFailureReason(reason: string): string {
  const trimmed = String(reason ?? '').trim();
  const regexMatch = trimmed.match(/^Regex assertion failed:\s*(.+)$/i);
  if (regexMatch) {
    return `Text match failed: ${regexMatch[1]}`;
  }
  return trimmed;
}
