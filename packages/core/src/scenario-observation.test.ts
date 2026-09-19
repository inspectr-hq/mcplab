import { describe, expect, it } from 'vitest';
import { evaluateScenarioObservation } from './scenario-observation.js';

describe('evaluateScenarioObservation', () => {
  it('marks tool checks not evaluated when telemetry is absent for a normal run', async () => {
    const result = await evaluateScenarioObservation({
      scenario: {
        id: 'external-search',
        servers: ['search'],
        prompt: 'Find Antwerp',
        eval: {
          tool_constraints: { required_tools: ['search'] },
          response_assertions: [{ type: 'contains', value: 'Antwerp' }]
        }
      },
      observation: {
        finalText: 'Antwerp is in Belgium.',
        startedAt: '2026-09-08T10:00:00.000Z',
        completedAt: '2026-09-08T10:00:01.000Z',
        executionSource: 'mcplab',
        client: 'claude'
      }
    });

    expect(result.outcome).toBe('incomplete');
    expect(result.pass).toBe(false);
    expect(result.check_results).toEqual([
      expect.objectContaining({ type: 'response_contains', status: 'passed' }),
      expect.objectContaining({ type: 'required_tool', status: 'not_executed' })
    ]);
  });

  it('marks unsupported Rover tool checks not evaluated and still passes', async () => {
    const result = await evaluateScenarioObservation({
      scenario: {
        id: 'browser-search',
        servers: ['search'],
        prompt: 'Find Antwerp',
        eval: {
          tool_constraints: { required_tools: ['search'] },
          response_assertions: [{ type: 'contains', value: 'Antwerp' }]
        }
      },
      observation: {
        finalText: 'Antwerp is in Belgium.',
        startedAt: '2026-09-08T10:00:00.000Z',
        completedAt: '2026-09-08T10:00:01.000Z',
        executionSource: 'rover',
        client: 'trendminer'
      }
    });

    expect(result.outcome).toBe('passed');
    expect(result.pass).toBe(true);
    expect(result.check_results).toEqual([
      expect.objectContaining({ type: 'response_contains', status: 'passed' }),
      expect.objectContaining({
        type: 'required_tool',
        status: 'not_evaluated',
        reason: expect.stringContaining('Tool telemetry')
      })
    ]);
  });

  it('evaluates an observed empty tool sequence as a failure', async () => {
    const result = await evaluateScenarioObservation({
      scenario: {
        id: 'observed-search',
        servers: ['search'],
        prompt: 'Find Antwerp',
        eval: { tool_constraints: { required_tools: ['search'] } }
      },
      observation: {
        finalText: 'No tools used.',
        toolCalls: [],
        startedAt: '2026-09-08T10:00:00.000Z',
        completedAt: '2026-09-08T10:00:01.000Z',
        executionSource: 'mcplab'
      }
    });

    expect(result.outcome).toBe('failed');
    expect(result.check_results?.[0]?.status).toBe('failed');
  });
});
