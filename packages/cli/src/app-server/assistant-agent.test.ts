import { describe, expect, it } from 'vitest';
import {
  resolveAssistantAgentFromConfig,
  resolveAssistantAgentFromLibraries
} from './assistant-agent.js';

function thrownMessage(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected operation to throw');
}

describe('assistant agent resolution errors', () => {
  it('uses assistant-neutral errors for missing config agents', () => {
    expect(
      thrownMessage(() => resolveAssistantAgentFromConfig({ agents: {} } as any, 'missing'))
    ).toBe("Assistant agent 'missing' not found in resolved config agents.");
  });

  it('uses assistant-neutral errors for browser agents from config', () => {
    expect(
      thrownMessage(() =>
        resolveAssistantAgentFromConfig(
          { agents: { browser: { type: 'browser' } } } as any,
          'browser'
        )
      )
    ).toBe("Browser agent 'browser' cannot be used as an assistant agent.");
  });

  it('uses assistant-neutral errors for missing library agents', () => {
    expect(
      thrownMessage(() => resolveAssistantAgentFromLibraries({ agents: {} } as any, 'missing'))
    ).toBe(
      "Assistant agent 'missing' not found in library agents. Configure an assistant agent in Libraries > Scenarios."
    );
  });

  it('uses assistant-neutral errors for browser agents from libraries', () => {
    expect(
      thrownMessage(() =>
        resolveAssistantAgentFromLibraries(
          { agents: { browser: { type: 'browser' } } } as any,
          'browser'
        )
      )
    ).toBe("Browser agent 'browser' cannot be used as an assistant agent.");
  });
});
