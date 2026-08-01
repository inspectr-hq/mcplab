import { describe, expect, it } from 'vitest';
import { selectGlobalCopilotAgentName } from './global-copilot-domain.js';

describe('selectGlobalCopilotAgentName', () => {
  it('prefers the dedicated global copilot setting', () => {
    expect(
      selectGlobalCopilotAgentName({
        globalCopilotAgentName: 'global',
        scenarioAssistantAgentName: 'scenario',
        agentNames: ['first', 'global', 'scenario']
      })
    ).toBe('global');
  });

  it('falls back to the scenario assistant, then the first agent', () => {
    expect(
      selectGlobalCopilotAgentName({
        scenarioAssistantAgentName: 'scenario',
        agentNames: ['first', 'scenario']
      })
    ).toBe('scenario');
    expect(selectGlobalCopilotAgentName({ agentNames: ['first'] })).toBe('first');
  });
});
