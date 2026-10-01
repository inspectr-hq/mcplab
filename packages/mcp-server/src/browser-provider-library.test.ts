import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();
});

function writeFixture(root: string): void {
  const bundle = join(root, 'mcplab');
  mkdirSync(bundle, { recursive: true });
  mkdirSync(join(bundle, 'browser-providers'), { recursive: true });
  writeFileSync(
    join(bundle, 'browser-providers', 'custom-chat.yaml'),
    `schema_version: 1\nname: Custom Chat\nmatch:\n  origins: [https://chat.example]\ncomposer:\n  locator:\n    segments: ['textarea[data-role="composer"]']\n  input_mode: textarea\nsubmit:\n  action: click\n  locator:\n    segments: ['button[data-action="send"]']\nassistant_messages:\n  locator:\n    segments: ['[data-role="assistant-message"]']\ncompletion:\n  stability_ms: 1000\nlearned:\n  source_origin: https://chat.example\n  confidence: {}\n`,
    'utf8'
  );
}

function setupTools(registerTools: (server: any) => void) {
  const tools = new Map<string, { cb: (args: Record<string, unknown>) => Promise<any> | any }>();
  registerTools({
    registerTool(
      name: string,
      _config: unknown,
      cb: (args: Record<string, unknown>) => Promise<any>
    ) {
      tools.set(name, { cb });
      return { name };
    }
  });
  return tools;
}

describe('browser provider library tools', () => {
  it('lists and retrieves normalized browser provider profiles from an isolated bundle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-browser-library-'));
    writeFixture(root);
    process.chdir(root);
    const runtime = await import('./runtime.js');
    const tools = setupTools(runtime.registerTools);

    const listed = await tools.get('mcplab_list_library')!.cb({
      kind: 'browser_providers',
      includeContent: true
    });
    expect(listed.structuredContent.browser_providers).toMatchObject([
      { id: 'chatgpt-com' },
      { id: 'claude' },
      {
        id: 'custom-chat',
        entry: {
          schemaVersion: 1,
          composer: { inputMode: 'textarea' },
          assistantMessages: expect.any(Object)
        }
      }
    ]);

    const item = await tools.get('mcplab_get_library_item')!.cb({
      kind: 'browser_providers',
      id: 'custom-chat'
    });
    expect(item.structuredContent.content).toMatchObject({
      schemaVersion: 1,
      composer: { inputMode: 'textarea' }
    });
    expect(item.structuredContent.yaml).toContain('schema_version: 1');
    expect(item.structuredContent.yaml).not.toContain('created_at');
    expect(item.structuredContent.yaml).not.toContain('updated_at');

    const builtIn = await tools.get('mcplab_get_library_item')!.cb({
      kind: 'browser_providers',
      id: 'claude'
    });
    expect(builtIn.structuredContent.content).toMatchObject({ id: 'claude', source: 'builtin' });
  });
});
