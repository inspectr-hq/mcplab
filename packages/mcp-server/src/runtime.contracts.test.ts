import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerTools } from './runtime.js';

type RegisteredTool = {
  config: { inputSchema?: unknown; outputSchema?: unknown };
  cb: (args: Record<string, unknown>) => Promise<any> | any;
};

function asSchema(schemaOrShape: unknown): z.ZodTypeAny {
  if (schemaOrShape && typeof (schemaOrShape as { safeParse?: unknown }).safeParse === 'function') {
    return schemaOrShape as z.ZodTypeAny;
  }
  return z.object((schemaOrShape ?? {}) as z.ZodRawShape);
}

function setupTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    registerTool: (
      name: string,
      config: { inputSchema?: unknown; outputSchema?: unknown },
      cb: (args: Record<string, unknown>) => Promise<any> | any
    ) => {
      tools.set(name, { config, cb });
      return { name };
    }
  };
  registerTools(fakeServer as any);
  return tools;
}

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe('mcp tool contracts', () => {
  it('mcplab_list_library returns canonical array shapes for servers/agents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-lib-'));
    mkdirSync(join(root, 'scenarios'), { recursive: true });
    writeFileSync(
      join(root, 'servers.yaml'),
      'server-a:\n  transport: http\n  url: http://localhost:3001/mcp\n',
      'utf8'
    );
    writeFileSync(
      join(root, 'agents.yaml'),
      'agent-a:\n  provider: openai\n  model: gpt-5\n',
      'utf8'
    );
    writeFileSync(
      join(root, 'scenarios', 'one.yaml'),
      'id: scenario-one\nservers: [server-a]\nprompt: test\n',
      'utf8'
    );

    const tools = setupTools();
    const tool = tools.get('mcplab_list_library');
    expect(tool).toBeDefined();

    const result = await tool!.cb({ bundleRoot: root, includeContent: false });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(Array.isArray(sc.servers)).toBe(true);
    expect(Array.isArray(sc.agents)).toBe(true);
    expect((sc.servers as Array<Record<string, unknown>>)[0]).toEqual({ id: 'server-a' });
    expect((sc.agents as Array<Record<string, unknown>>)[0]).toEqual({ id: 'agent-a' });

    const outputSchema = asSchema(tool!.config.outputSchema);
    const parsed = outputSchema.safeParse(sc);
    expect(parsed.success).toBe(true);
  });

  it('mcplab_generate_server_entry input schema enforces auth-specific requirements', () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_generate_server_entry');
    expect(tool).toBeDefined();

    const schema = asSchema(tool!.config.inputSchema);

    expect(schema.safeParse({ id: 's1', url: 'http://x/mcp', auth_type: 'bearer' }).success).toBe(
      false
    );
    expect(schema.safeParse({ id: 's1', url: 'http://x/mcp', auth_type: 'api_key' }).success).toBe(
      false
    );
    expect(
      schema.safeParse({ id: 's1', url: 'http://x/mcp', auth_type: 'oauth_client_credentials' })
        .success
    ).toBe(false);

    expect(
      schema.safeParse({
        id: 's1',
        url: 'http://x/mcp',
        auth_type: 'bearer',
        bearer_env: 'TOKEN_ENV'
      }).success
    ).toBe(true);
  });

  it('mcplab_write_markdown_report has explicit output schema with error_code enum', () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_write_markdown_report');
    expect(tool).toBeDefined();

    const schema = asSchema(tool!.config.outputSchema);

    expect(
      schema.safeParse({
        ok: true,
        path: '/tmp/a.md',
        bytes: 1,
        chars: 1,
        overwritten: false,
        workspace_root: '/tmp'
      }).success
    ).toBe(true);

    expect(
      schema.safeParse({ ok: false, error_code: 'INVALID_EXTENSION', error_message: 'bad' }).success
    ).toBe(true);

    expect(
      schema.safeParse({ ok: false, error_code: 'NOT_A_REAL_CODE', error_message: 'x' }).success
    ).toBe(false);
  });

  it('mcplab_read_markdown_report rejects traversal/absolute paths and reports_dir escapes', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mcplab-ws-'));
    process.chdir(workspace);
    mkdirSync(join(workspace, 'mcplab', 'reports'), { recursive: true });
    writeFileSync(join(workspace, 'mcplab', 'reports', 'ok.md'), '# ok\n', 'utf8');

    const tools = setupTools();
    const tool = tools.get('mcplab_read_markdown_report');
    expect(tool).toBeDefined();

    const schema = asSchema(tool!.config.inputSchema);
    expect(schema.safeParse({ path: '../../etc/passwd' }).success).toBe(false);
    expect(schema.safeParse({ path: '/etc/passwd' }).success).toBe(false);
    expect(schema.safeParse({ path: 'ok.md', reports_dir: '../outside' }).success).toBe(false);

    const bad = await tool!.cb({ path: '../../etc/passwd' });
    expect(bad.isError).toBe(true);

    const good = await tool!.cb({ path: 'ok.md' });
    expect(good.isError).not.toBe(true);
    expect((good.structuredContent as Record<string, unknown>).name).toBe('ok.md');
  });
});
