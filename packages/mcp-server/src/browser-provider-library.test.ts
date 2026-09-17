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
  writeFileSync(
    join(bundle, 'browser-providers.yaml'),
    `custom-chat:\n  schema_version: 1\n  name: Custom Chat\n  match:\n    origins: [https://chat.example]\n  composer:\n    locator:\n      segments: ['textarea[data-role="composer"]']\n    input_mode: textarea\n  submit:\n    action: click\n    locator:\n      segments: ['button[data-action="send"]']\n  assistant_messages:\n    locator:\n      segments: ['[data-role="assistant-message"]']\n  completion:\n    stability_ms: 1000\n  learned:\n    source_origin: https://chat.example\n    created_at: 2026-09-17T00:00:00.000Z\n    updated_at: 2026-09-17T00:00:00.000Z\n    confidence: {}\n`,
    'utf8'
  );
}

function setupTools(registerTools: (server: any) => void) {
  const tools = new Map<string, { cb: (args: Record<string, unknown>) => Promise<any> | any }>();
  registerTools({
    registerTool(name: string, _config: unknown, cb: (args: Record<string, unknown>) => Promise<any>) {
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
    expect(item.structuredContent.yaml).toContain('schemaVersion: 1');
  });
});
