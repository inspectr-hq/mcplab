import { describe, expect, it } from 'vitest';
import { migrateSourceConfig } from './migrate-utils.js';
import type { SourceEvalConfig } from '@inspectr/mcplab-core';

function baseConfig(overrides: Partial<SourceEvalConfig> = {}): SourceEvalConfig {
  return {
    agents: [],
    scenarios: [],
    ...overrides
  } as SourceEvalConfig;
}

describe('migrateSourceConfig', () => {
  it('converts legacy scenario servers string[] to mcp_servers refs for library servers', () => {
    const source = baseConfig({
      servers: [{ ref: 'weather-mcp' }],
      scenarios: [
        { id: 'scn-1', servers: ['weather-mcp'], prompt: 'test' } as any
      ]
    });

    const result = migrateSourceConfig(source);

    expect(result.servers).toEqual([]);
    expect((result.scenarios[0] as any).mcp_servers).toEqual([{ ref: 'weather-mcp' }]);
    expect((result.scenarios[0] as any).servers).toBeUndefined();
  });

  it('preserves full inline server definition when top-level server is inline', () => {
    const source = baseConfig({
      servers: [
        {
          id: 'my-api',
          name: 'My API',
          transport: 'http',
          url: 'http://localhost:3001/mcp'
        }
      ] as any,
      scenarios: [
        { id: 'scn-1', servers: ['my-api'], prompt: 'test' } as any
      ]
    });

    const result = migrateSourceConfig(source);

    expect(result.servers).toEqual([]);
    expect((result.scenarios[0] as any).mcp_servers).toEqual([
      { id: 'my-api', name: 'My API', transport: 'http', url: 'http://localhost:3001/mcp' }
    ]);
  });

  it('mixes inline and ref entries correctly in one scenario', () => {
    const source = baseConfig({
      servers: [
        { ref: 'lib-server' },
        { id: 'inline-svc', transport: 'http', url: 'http://localhost:3002/mcp' }
      ] as any,
      scenarios: [
        { id: 'scn-1', servers: ['lib-server', 'inline-svc'], prompt: 'test' } as any
      ]
    });

    const result = migrateSourceConfig(source);

    expect((result.scenarios[0] as any).mcp_servers).toEqual([
      { ref: 'lib-server' },
      { id: 'inline-svc', transport: 'http', url: 'http://localhost:3002/mcp' }
    ]);
  });

  it('falls back to ref for unknown server IDs', () => {
    const source = baseConfig({
      servers: [],
      scenarios: [
        { id: 'scn-1', servers: ['unknown-server'], prompt: 'test' } as any
      ]
    });

    const result = migrateSourceConfig(source);

    expect((result.scenarios[0] as any).mcp_servers).toEqual([{ ref: 'unknown-server' }]);
  });

  it('leaves scenarios that already have mcp_servers untouched', () => {
    const source = baseConfig({
      servers: [{ id: 'my-api', transport: 'http', url: 'http://localhost:3001/mcp' }] as any,
      scenarios: [
        {
          id: 'scn-1',
          mcp_servers: [{ ref: 'my-api' }],
          prompt: 'test'
        } as any
      ]
    });

    const result = migrateSourceConfig(source);

    expect((result.scenarios[0] as any).mcp_servers).toEqual([{ ref: 'my-api' }]);
  });

  it('leaves ref scenarios untouched', () => {
    const source = baseConfig({
      scenarios: [{ ref: 'scn-weather' }]
    });

    const result = migrateSourceConfig(source);

    expect(result.scenarios[0]).toEqual({ ref: 'scn-weather' });
  });
});
