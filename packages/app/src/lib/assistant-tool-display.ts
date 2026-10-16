import { formatAssistantToolName } from '@/lib/assistant-tool-name';
import type { AssistantRuntimeToolCall } from '@/lib/data-sources/types';

type ToolCallLike = Pick<
  AssistantRuntimeToolCall,
  'tool' | 'arguments' | 'status' | 'error' | 'startedAt' | 'completedAt'
> &
  Partial<Pick<AssistantRuntimeToolCall, 'title' | 'hints' | 'argumentLabels'>>;

export interface ToolCallRisk {
  label: string;
  tone: 'danger' | 'caution';
}

export interface ToolCallField {
  key: string;
  label: string;
  value: string;
}

/** The tool's own title when the MCP server gives one, otherwise its name made readable. */
export function toolCallTitle(call: Pick<ToolCallLike, 'tool' | 'title'>): string {
  return call.title?.trim() || humanize(formatAssistantToolName(call.tool));
}

/** What the MCP server says the tool may do, phrased for someone deciding whether to allow it. */
export function toolCallRisks(call: Pick<ToolCallLike, 'hints'>): ToolCallRisk[] {
  const hints = call.hints;
  if (!hints || hints.readOnly) return [];
  return [
    ...(hints.destructive ? [{ label: 'Can change or delete data', tone: 'danger' as const }] : []),
    ...(hints.openWorld ? [{ label: 'Reaches external systems', tone: 'caution' as const }] : [])
  ];
}

/** Arguments as labelled fields; undefined when they are not a plain object. */
export function toolCallFields(
  call: Pick<ToolCallLike, 'arguments' | 'argumentLabels'>
): ToolCallField[] | undefined {
  const args = call.arguments;
  if (!isRecord(args)) return undefined;
  return Object.entries(args).map(([key, value]) => ({
    key,
    label: call.argumentLabels?.[key] ?? humanize(key),
    value: formatValue(value)
  }));
}

/** How long the tool ran, once it has finished. */
export function toolCallDuration(call: Pick<ToolCallLike, 'startedAt' | 'completedAt'>) {
  if (!call.startedAt || !call.completedAt) return undefined;
  const ms = Date.parse(call.completedAt) - Date.parse(call.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : undefined;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** A one-line summary for compact rows: the error, or the argument that identifies the call. */
export function toolCallSummary(call: ToolCallLike): string {
  if (call.status === 'error' && call.error) return call.error;
  const args = isRecord(call.arguments) ? call.arguments : {};
  if (call.tool === 'read_mcp_resource' && typeof args.uri === 'string') return args.uri;
  if (call.tool === 'get_mcp_prompt' && typeof args.name === 'string') return args.name;
  if (call.tool === 'list_mcp_resources' || call.tool === 'list_mcp_prompts')
    return typeof args.server === 'string' ? args.server : 'All servers';
  const first = Object.values(args).find(
    (value) => (typeof value === 'string' && value.trim()) || typeof value === 'number'
  );
  return first === undefined ? '' : String(first);
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  const compact = JSON.stringify(value);
  return compact.length > 60 ? JSON.stringify(value, null, 2) : compact;
}

function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
