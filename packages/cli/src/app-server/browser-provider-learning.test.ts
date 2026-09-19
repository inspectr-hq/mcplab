import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chatWithJsonRetryMock } = vi.hoisted(() => ({
  chatWithJsonRetryMock: vi.fn()
}));

vi.mock('./assistant-common.js', () => ({ chatWithJsonRetry: chatWithJsonRetryMock }));

import {
  parseBrowserProviderProposal,
  proposeBrowserProviderProfile,
  sanitizeBrowserProviderLearningTrace,
  sanitizeBrowserProviderProposalDiagnostics
} from './browser-provider-learning.js';

const profile = {
  schemaVersion: 1 as const,
  id: 'example',
  name: 'Example',
  match: { origins: ['https://example.com'] },
  composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' as const },
  submit: { action: 'click' as const, locator: { segments: ['button[aria-label="Send"]'] } },
  assistantMessages: { locator: { segments: ['[data-role="assistant"]'] } },
  completion: { stabilityMs: 2500 },
  learned: {
    sourceOrigin: 'https://example.com',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    confidence: {}
  }
};

describe('browser provider learning proposals', () => {
  beforeEach(() => chatWithJsonRetryMock.mockReset());

  it('validates and returns the model proposal', async () => {
    chatWithJsonRetryMock.mockResolvedValue({
      profile,
      rationale: ['Observed the send control.'],
      warnings: [],
      validated: true
    });

    const proposal = await proposeBrowserProviderProfile({
      agent: { type: 'llm', provider: 'openai', model: 'gpt-test' } as never,
      profile,
      trace: { observedGeneration: true, events: [] }
    });

    expect(proposal.validated).toBe(true);
    expect(proposal.profile.id).toBe('example');
    expect(proposal.rationale).toEqual(['Observed the send control.']);
    expect(chatWithJsonRetryMock).toHaveBeenCalledOnce();
  });

  it('rejects a proposal that is not a valid browser profile', async () => {
    expect(() => parseBrowserProviderProposal(JSON.stringify({ profile: { id: 'bad' } }))).toThrow(
      'Unsupported browser provider profile schema.'
    );
  });

  it('sanitizes learning traces before they are sent to the model or persisted', () => {
    const trace = sanitizeBrowserProviderLearningTrace({
      observedGeneration: true,
      events: [
        {
          phase: 'final',
          candidateCount: 1,
          selectedCandidate: { text: 'raw response must not survive' },
          text: 'raw response must not survive'
        }
      ]
    });
    expect(JSON.stringify(trace)).not.toContain('raw response must not survive');
    expect(trace.observedGeneration).toBe(true);
  });

  it('sanitizes proposal diagnostics before persistence', () => {
    const diagnostics = sanitizeBrowserProviderProposalDiagnostics({
      rationale: ['safe', { raw: 'drop me' }, 'x'.repeat(600)],
      warnings: ['warning'],
      rawResponse: 'do not persist this'
    });
    expect(diagnostics).toEqual({
      rationale: ['safe', 'x'.repeat(500)],
      warnings: ['warning']
    });
    expect(JSON.stringify(diagnostics)).not.toContain('drop me');
    expect(JSON.stringify(diagnostics)).not.toContain('do not persist');
  });
});
