import type { AssistantRuntimeToolCall } from '@/lib/data-sources/types';

/**
 * The backend reports only pending, approved, denied and error. The finer states the UI shows
 * (running vs completed, skipped, cancelled, outcome unknown, not run) come from the call's
 * result and the runtime's settle messages, interpreted here and nowhere else.
 */
export type ToolCallDisplayState =
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'denied'
  | 'skipped'
  | 'cancelled'
  | 'outcome_unknown'
  | 'not_run'
  | 'failed';

export type ToolCallDisplayTone = 'attention' | 'progress' | 'success' | 'neutral' | 'danger';

export interface ToolCallDisplay {
  state: ToolCallDisplayState;
  label: string;
  tone: ToolCallDisplayTone;
  /** Settled calls have a final result the model has seen (or will see). */
  settled: boolean;
  /** Extra explanation for states that are not self-explanatory. */
  detail?: string;
}

type ToolCallLike = Pick<AssistantRuntimeToolCall, 'status' | 'error' | 'resultPreview'>;

export function describeToolCall(call: ToolCallLike): ToolCallDisplay {
  const error = call.error ?? '';
  if (call.status === 'pending')
    return {
      state: 'awaiting_approval',
      label: 'Needs approval',
      tone: 'attention',
      settled: false
    };
  if (call.status === 'approved')
    return call.resultPreview === undefined
      ? { state: 'running', label: 'Running', tone: 'progress', settled: false }
      : { state: 'completed', label: 'Completed', tone: 'success', settled: true };
  if (call.status === 'denied') {
    if (/superseded/i.test(error))
      return {
        state: 'skipped',
        label: 'Skipped',
        tone: 'neutral',
        settled: true,
        detail: 'Not run because a new message replaced this request.'
      };
    return { state: 'denied', label: 'Denied', tone: 'neutral', settled: true };
  }
  if (/outcome unknown/i.test(error))
    return {
      state: 'outcome_unknown',
      label: 'Outcome unknown',
      tone: 'danger',
      settled: true,
      detail: 'The call was interrupted while running; it may or may not have taken effect.'
    };
  if (/cancelled before execution/i.test(error))
    return {
      state: 'cancelled',
      label: 'Cancelled',
      tone: 'neutral',
      settled: true,
      detail: 'Not run because the response was stopped.'
    };
  if (/budget exhausted/i.test(error))
    return {
      state: 'not_run',
      label: 'Not run',
      tone: 'neutral',
      settled: true,
      detail: 'Not run because the turn reached its model-call limit.'
    };
  return { state: 'failed', label: 'Error', tone: 'danger', settled: true };
}
