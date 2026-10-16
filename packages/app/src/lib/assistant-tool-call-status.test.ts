import { describe, expect, it } from 'vitest';
import { describeToolCall } from './assistant-tool-call-status';

describe('describeToolCall', () => {
  it('distinguishes an approved call that is still running from one that completed', () => {
    expect(describeToolCall({ status: 'approved' })).toMatchObject({
      state: 'running',
      settled: false
    });
    expect(describeToolCall({ status: 'approved', resultPreview: '{"ok":true}' })).toMatchObject({
      state: 'completed',
      label: 'Completed',
      settled: true
    });
    expect(describeToolCall({ status: 'approved', resultPreview: '' })).toMatchObject({
      state: 'completed'
    });
  });

  it('maps pending calls to an approval request', () => {
    expect(describeToolCall({ status: 'pending' })).toMatchObject({
      state: 'awaiting_approval',
      label: 'Needs approval',
      settled: false
    });
  });

  it.each([
    ['denied', 'User denied tool call', 'denied', 'Denied'],
    [
      'denied',
      'Tool call skipped because a new user message superseded the turn',
      'skipped',
      'Skipped'
    ],
    [
      'error',
      'Tool execution outcome unknown because cancellation interrupted the response',
      'outcome_unknown',
      'Outcome unknown'
    ],
    [
      'error',
      'Tool execution outcome unknown because a new user message superseded the turn',
      'outcome_unknown',
      'Outcome unknown'
    ],
    ['error', 'Tool call cancelled before execution', 'cancelled', 'Cancelled'],
    ['error', 'Assistant turn model-call budget exhausted', 'not_run', 'Not run'],
    ['error', "Invalid arguments for tool 'lookup': malformed", 'failed', 'Error'],
    ['error', undefined, 'failed', 'Error']
  ] as const)('maps a %s call with "%s" to %s', (status, error, state, label) => {
    const display = describeToolCall({ status, ...(error ? { error } : {}) });
    expect(display).toMatchObject({ state, label, settled: true });
  });

  it('explains the states whose label alone is ambiguous', () => {
    for (const error of [
      'Tool execution outcome unknown because cancellation interrupted the response',
      'Tool call cancelled before execution',
      'Assistant turn model-call budget exhausted'
    ])
      expect(describeToolCall({ status: 'error', error }).detail).toBeTruthy();
  });
});
