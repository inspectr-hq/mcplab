import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  availableGlobalCopilotActions,
  invokeGlobalCopilotAction,
  registerGlobalCopilotAction
} from './global-copilot-actions';

describe('global copilot actions', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it('only exposes a registered page action and removes it on cleanup', async () => {
    const action = vi.fn();
    cleanups.push(registerGlobalCopilotAction('start_evaluation_run', action));

    expect(availableGlobalCopilotActions()).toContain('start_evaluation_run');
    await invokeGlobalCopilotAction('start_evaluation_run');
    expect(action).toHaveBeenCalledOnce();

    cleanups.pop()?.();
    await expect(invokeGlobalCopilotAction('start_evaluation_run')).rejects.toThrow(
      'no longer available'
    );
  });

  it('passes validated arguments to a registered library action', async () => {
    const action = vi.fn();
    cleanups.push(registerGlobalCopilotAction('duplicate_test_case', action));

    await invokeGlobalCopilotAction('duplicate_test_case', { id: 'tag-profile' });

    expect(action).toHaveBeenCalledWith({ id: 'tag-profile' });
  });

  it('passes temporary overrides to the registered queue-backed evaluation action', async () => {
    const action = vi.fn();
    cleanups.push(registerGlobalCopilotAction('queue_evaluation_run', action));

    await invokeGlobalCopilotAction('queue_evaluation_run', {
      configId: 'tag-profile',
      agentIds: ['azure-deepseek-v4-flash'],
      serverOverrideAll: ['mcp-lab']
    });

    expect(action).toHaveBeenCalledWith({
      configId: 'tag-profile',
      agentIds: ['azure-deepseek-v4-flash'],
      serverOverrideAll: ['mcp-lab']
    });
  });

  it('registers a confirmation action for creating a Test Case', async () => {
    const action = vi.fn();
    cleanups.push(registerGlobalCopilotAction('create_test_case', action));

    await invokeGlobalCopilotAction('create_test_case', {
      id: 'list-library',
      servers: ['mcp-lab'],
      prompt: 'List library entries.'
    });

    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'list-library', servers: ['mcp-lab'] })
    );
  });
});
