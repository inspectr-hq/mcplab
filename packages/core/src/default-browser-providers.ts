import type { BrowserProviderProfile } from './browser-providers.js';

/**
 * Declarative metadata for the providers implemented natively by Rover.
 *
 * Rover keeps the executable adapters for these providers. MCP Lab exposes
 * these profiles so they are available in the library UI and API without a
 * workspace file. Workspace profiles with the same id take precedence.
 */
export const DEFAULT_BROWSER_PROVIDER_PROFILES: Record<string, BrowserProviderProfile> = {
  claude: {
    schemaVersion: 1,
    id: 'claude',
    name: 'Claude',
    source: 'builtin',
    match: { origins: ['https://claude.ai'] },
    composer: {
      locator: { segments: ['div[contenteditable="true"].ProseMirror'] },
      inputMode: 'contenteditable'
    },
    submit: {
      action: 'click',
      locator: { segments: ['button[aria-label="Send message"]'] }
    },
    assistantMessages: {
      locator: {
        segments: [
          '[data-is-streaming]'
        ]
      }
    },
    completion: {
      generatingLocator: {
        segments: ['[aria-label*="Stop"], button[data-is-streaming="true"]']
      },
      stabilityMs: 2500
    },
    learned: {
      sourceOrigin: 'https://claude.ai',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      confidence: {
        composer: 'high',
        submit: 'high',
        assistant: 'high',
        completion: 'medium'
      }
    }
  },
  'chatgpt-com': {
    schemaVersion: 1,
    id: 'chatgpt-com',
    name: 'ChatGPT',
    source: 'builtin',
    match: { origins: ['https://chatgpt.com', 'https://chat.openai.com'] },
    composer: {
      locator: {
        segments: ['[aria-label="Chat with ChatGPT"], [contenteditable="true"]']
      },
      inputMode: 'contenteditable'
    },
    submit: { action: 'enter' },
    assistantMessages: {
      locator: { segments: ['[data-message-author-role="assistant"]'] }
    },
    completion: {
      generatingLocator: {
        segments: ['button[aria-label*="Stop"], [data-testid="stop-button"]']
      },
      idleLocator: {
        segments: ['[aria-label="Chat with ChatGPT"], [contenteditable="true"]']
      },
      stabilityMs: 2500
    },
    newConversation: {
      action: 'click',
      locator: {
        segments: [
          'a[href="/"], a[href="/new"], button[aria-label*="New chat"], button[aria-label*="New conversation"]'
        ]
      }
    },
    learned: {
      sourceOrigin: 'https://chatgpt.com',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      confidence: {
        composer: 'high',
        submit: 'high',
        assistant: 'high',
        completion: 'medium',
        newConversation: 'medium'
      }
    }
  }
};
