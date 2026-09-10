import { describe, expect, it } from 'vitest';
import { parseBrowserProviderProfiles, validateBrowserProviderProfile } from './browser-providers.js';

describe('browser provider profiles', () => {
  it('parses the declarative YAML shape into a validated runtime profile', () => {
    const profiles = parseBrowserProviderProfiles({
      trendminer: {
        schema_version: 1,
        name: 'TrendMiner',
        match: { origins: ['https://tm-pipeline-aa01.trendminer.net'] },
        composer: { locator: { segments: ['[data-test="composer"]'] }, input_mode: 'contenteditable' },
        submit: { action: 'click', locator: { segments: ['button[aria-label="Submit"]'] } },
        assistant_messages: { locator: { segments: ['.assistant'] } },
        completion: { stability_ms: 2500 },
        new_conversation: { action: 'click', locator: { segments: ['button[aria-label="New chat"]'] } },
        learned: { source_origin: 'https://tm-pipeline-aa01.trendminer.net', confidence: { composer: 'high' } }
      }
    });

    expect(profiles.trendminer).toMatchObject({
      id: 'trendminer',
      name: 'TrendMiner',
      composer: { inputMode: 'contenteditable' },
      submit: { action: 'click' },
      newConversation: { action: 'click' }
    });
  });

  it('rejects executable or incomplete profiles', () => {
    expect(() => validateBrowserProviderProfile({
      id: 'bad',
      name: 'Bad',
      match: { origins: ['https://example.com'] },
      composer: { locator: { segments: [] }, inputMode: 'input' },
      submit: { action: 'click' },
      assistantMessages: { locator: { segments: ['.assistant'] } },
      completion: { stabilityMs: 1000 },
      learned: { sourceOrigin: 'https://example.com', confidence: {} },
      script: 'alert(1)'
    } as never)).toThrow(/profile|script|composer/i);
  });
});
