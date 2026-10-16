import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chatWithJsonRetryMock } = vi.hoisted(() => ({
  chatWithJsonRetryMock: vi.fn()
}));

vi.mock('./one-shot-json.js', async () => ({
  ...(await vi.importActual<typeof import('./one-shot-json.js')>('./one-shot-json.js')),
  chatWithJsonRetry: chatWithJsonRetryMock
}));

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
  it('uses the final proposal rather than a quoted current profile', () => {
    const proposed = { ...profile, completion: { stabilityMs: 4000 } };
    const proposal = {
      profile: proposed,
      rationale: ['Observed longer response gaps.'],
      warnings: ['Review timing.']
    };
    expect(
      parseBrowserProviderProposal(
        `Current profile:\n${JSON.stringify(profile)}\nProposal:\n${JSON.stringify(proposal)}`
      )
    ).toMatchObject({ ...proposal, validated: true });
  });

  it('rejects an invalid final proposal instead of returning an earlier valid quote', () => {
    expect(() =>
      parseBrowserProviderProposal(
        `Current profile:\n${JSON.stringify({ profile })}\nProposal:\n${JSON.stringify({ profile: { id: 'bad' }, rationale: ['Updated'] })}`
      )
    ).toThrow('Unsupported browser provider profile schema.');
  });

  it('retains working evidence validation when an earlier quoted profile is valid', () => {
    const proposed = {
      ...profile,
      completion: { ...profile.completion, workingLocator: { segments: ['[role="article"]'] } }
    };
    expect(() =>
      parseBrowserProviderProposal(
        `Current profile:\n${JSON.stringify(profile)}\nProposal:\n${JSON.stringify({ profile: proposed })}`,
        { observedGeneration: true, events: [{ phase: 'final', workingActive: false }] }
      )
    ).toThrow('Working locator evidence is incomplete');
  });

  it('uses a final unwrapped profile after a quoted proposal wrapper', () => {
    const proposed = { ...profile, completion: { stabilityMs: 4000 } };
    expect(
      parseBrowserProviderProposal(
        `Current profile:\n${JSON.stringify({ profile })}\nProposal:\n${JSON.stringify(proposed)}`
      ).profile
    ).toEqual(proposed);
  });

  it.each(['{"example":true}\n', '```json\n{"example":true}\n```\n'])(
    'skips parseable JSON that is not a valid proposal (%s)',
    (prefix) => {
      expect(parseBrowserProviderProposal(`${prefix}${JSON.stringify({ profile })}`)).toMatchObject(
        {
          profile,
          validated: true
        }
      );
    }
  );
  beforeEach(() => chatWithJsonRetryMock.mockReset());

  it.each(['```json', '```', 'Here is the reviewed profile:\n```json'])(
    'accepts a valid proposal wrapped in %s',
    (prefix) => {
      const proposal = { profile, rationale: ['Observed send control.'], warnings: [] };
      expect(
        parseBrowserProviderProposal(`${prefix}\n${JSON.stringify(proposal)}\n\`\`\``)
      ).toMatchObject({ ...proposal, validated: true });
    }
  );

  it('still rejects an invalid profile inside a JSON code block', () => {
    expect(() => parseBrowserProviderProposal('```json\n{"profile":{"id":"bad"}}\n```')).toThrow(
      'Unsupported browser provider profile schema.'
    );
  });

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
    expect(chatWithJsonRetryMock.mock.calls[0][0].invalidJsonRetryPrompt).toContain(
      'profile (the complete browser provider profile)'
    );
  });

  it('preserves confirmed New Chat when a proposal omits confirmation', async () => {
    const captured = {
      ...profile,
      newConversation: {
        action: 'click' as const,
        locator: { segments: ['button.new-chat'] },
        confirmation: 'context-change' as const
      }
    };
    const proposed = {
      ...profile,
      newConversation: {
        action: 'click' as const,
        locator: { segments: ['button[aria-label="New chat"]'] }
      }
    };
    chatWithJsonRetryMock.mockResolvedValue({
      profile: proposed,
      rationale: [],
      warnings: [],
      validated: true
    });

    const result = await proposeBrowserProviderProfile({
      agent: { type: 'llm', provider: 'openai', model: 'gpt-test' } as never,
      profile: captured,
      trace: { events: [] }
    });

    expect(result.profile.newConversation).toMatchObject({
      locator: { segments: ['button[aria-label="New chat"]'] },
      confirmation: 'context-change'
    });
  });

  it('rejects a proposal that is not a valid browser profile', async () => {
    expect(() => parseBrowserProviderProposal(JSON.stringify({ profile: { id: 'bad' } }))).toThrow(
      'Unsupported browser provider profile schema.'
    );
  });

  it('narrows a persistent response container to the transient working condition', () => {
    const trace = {
      observedGeneration: true,
      events: [
        { phase: 'submitted', workingActive: false },
        {
          phase: 'working',
          workingActive: true,
          selectedElements: {
            working: {
              locator: { segments: ['[role="article"]'] },
              selectors: ['[role="article"]', 'div[aria-busy="true"]', 'div'],
              visible: true
            }
          }
        },
        { phase: 'final', workingActive: false }
      ]
    };

    const proposal = parseBrowserProviderProposal(
      JSON.stringify({
        profile: {
          ...profile,
          completion: {
            ...profile.completion,
            workingLocator: { segments: ['[role="article"]'] }
          }
        }
      }),
      trace
    );

    expect(proposal.profile.completion.workingLocator).toEqual({
      segments: ['[role="article"][aria-busy="true"]']
    });
    expect(proposal.warnings).toContain(
      'The working locator was narrowed to preserve the observed transient aria-busy state.'
    );
  });

  it('rejects a working locator that is not active after submission and inactive at final', () => {
    expect(() =>
      parseBrowserProviderProposal(
        JSON.stringify({
          profile: {
            ...profile,
            completion: {
              ...profile.completion,
              workingLocator: { segments: ['[role="article"]'] }
            }
          }
        }),
        {
          observedGeneration: true,
          events: [
            { phase: 'submitted', workingActive: false },
            { phase: 'final', workingActive: false }
          ]
        }
      )
    ).toThrow('Working locator evidence is incomplete');
  });

  it('accepts the transient compound selector supported by the working trace', () => {
    const trace = {
      observedGeneration: true,
      events: [
        { phase: 'submitted', workingActive: false },
        {
          phase: 'working',
          workingActive: true,
          selectedElements: {
            working: {
              locator: { segments: ['[role="article"]'] },
              selectors: ['[role="article"]', 'div[aria-busy="true"]'],
              visible: true
            }
          }
        },
        { phase: 'final', workingActive: false }
      ]
    };

    const proposal = parseBrowserProviderProposal(
      JSON.stringify({
        profile: {
          ...profile,
          completion: {
            ...profile.completion,
            workingLocator: { segments: ['[role="article"][aria-busy="true"]'] }
          }
        }
      }),
      trace
    );

    expect(proposal.profile.completion.workingLocator?.segments).toEqual([
      '[role="article"][aria-busy="true"]'
    ]);
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

  it('retains selected semantic evidence for the Judge without raw response text', () => {
    const trace = sanitizeBrowserProviderLearningTrace({
      evidenceVersion: 1,
      observedGeneration: true,
      newConversationEvidence: {
        controlLocator: { segments: ['button[title="New chat"]'] },
        controlSelectors: ['button[title="New chat"]'],
        signal: 'assistant-count-reduced',
        beforeAssistantCount: 1,
        afterAssistantCount: 0
      },
      events: [
        {
          phase: 'final',
          workingActive: false,
          selectedElements: {
            assistant: {
              locator: { segments: ['[data-testid="markdown-reply"]'] },
              selectors: ['[data-testid="markdown-reply"]'],
              visible: true,
              textLength: 23,
              changedAfterSubmission: true,
              absentAtSubmission: true,
              candidateScore: 21,
              attributes: { testId: 'markdown-reply' },
              rawText: 'secret answer must not survive'
            }
          }
        }
      ]
    });
    expect(trace).toMatchObject({
      evidenceVersion: 1,
      newConversationEvidence: { signal: 'assistant-count-reduced' },
      events: [
        {
          workingActive: false,
          selectedElements: {
            assistant: {
              locator: { segments: ['[data-testid="markdown-reply"]'] },
              changedAfterSubmission: true,
              absentAtSubmission: true
            }
          }
        }
      ]
    });
    expect(JSON.stringify(trace)).not.toContain('secret answer must not survive');
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
