import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LiveTestService,
  listLiveTestCases,
  type LiveTestSession
} from './live-tests.js';

const scenarios = [
  {
    id: 'plain',
    name: 'Plain case',
    servers: ['search'],
    prompt: 'Find Antwerp',
    eval: { response_assertions: [{ type: 'contains' as const, value: 'Antwerp' }] }
  },
  {
    id: 'attachment',
    servers: ['vision'],
    prompt: 'Describe this',
    attachments: [{ type: 'image' as const, media_type: 'image/png', data: 'abc' }]
  }
];

describe('Live Test catalog', () => {
  it('returns safe summaries and disables attachment cases', () => {
    const result = listLiveTestCases(scenarios);
    expect(result).toEqual([
      expect.objectContaining({ id: 'plain', eligible: true, assertionCount: 1 }),
      expect.objectContaining({ id: 'attachment', eligible: false, ineligibleReason: expect.stringContaining('Attachments') })
    ]);
    expect(result[0]).not.toHaveProperty('prompt');
    expect(JSON.stringify(result)).not.toContain('servers');
  });
});

describe('LiveTestService', () => {
  it('freezes a selected test case and completes idempotently', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'mcplab-live-test-'));
    let persisted = 0;
    const service = new LiveTestService({
      runsDir,
      cliVersion: 'test',
      readScenarios: () => scenarios,
      persist: () => {
        persisted += 1;
      }
    });
    const session = service.start({ testCaseId: 'plain', client: 'claude' });
    scenarios[0].prompt = 'Changed after start';

    const first = await service.complete(session.id, {
      finalText: 'Antwerp is in Belgium.',
      startedAt: '2026-09-08T10:00:00.000Z',
      completedAt: '2026-09-08T10:00:01.000Z'
    });
    const repeated = await service.complete(session.id, {
      finalText: 'Antwerp is in Belgium.',
      startedAt: '2026-09-08T10:00:00.000Z',
      completedAt: '2026-09-08T10:00:01.000Z'
    });

    expect(first).toEqual(repeated);
    expect(first.outcome).toBe('passed');
    expect(persisted).toBe(1);
    expect((service.get(session.id) as LiveTestSession).testCase.prompt).toBe('Find Antwerp');
  });

  it('rejects conflicting completion data', async () => {
    const service = new LiveTestService({
      runsDir: '/tmp',
      cliVersion: 'test',
      readScenarios: () => scenarios,
      persist: () => undefined
    });
    const session = service.start({ testCaseId: 'plain', client: 'claude' });
    const base = {
      startedAt: '2026-09-08T10:00:00.000Z',
      completedAt: '2026-09-08T10:00:01.000Z'
    };
    await service.complete(session.id, { ...base, finalText: 'Antwerp' });
    await expect(service.complete(session.id, { ...base, finalText: 'Different' })).rejects.toMatchObject({ statusCode: 409 });
  });
});
