import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeModelOutput
} from '@inspectr/mcplab-core';
import type { AssistantRuntimeFactory } from '@inspectr/mcplab-core';
import type { AssistantModelCall } from './scripted-chat-model.js';
import { validateScenarioAssistantProposal } from '../src/app-server/scenario-assistant-domain.js';

export function assistantRuntimeContract(
  name: string,
  createRuntimeFactory: (modelCall?: AssistantModelCall) => AssistantRuntimeFactory
) {
  describe(name, () => {
    it('keeps snapshot revisions monotonic across changed turns', async () => {
      const session = await createRuntimeFactory(async () => ({
        type: 'assistant_message',
        text: 'Done'
      })).create(makeDefinition());
      const initialRevision = session.getSnapshot().revision;
      await session.sendMessage('first');
      const firstRevision = session.getSnapshot().revision;
      expect(firstRevision).toBeGreaterThan(initialRevision);
      expect(session.getSnapshot().revision).toBe(firstRevision);
      await session.sendMessage('second');
      expect(session.getSnapshot().revision).toBeGreaterThan(firstRevision);
      await session.dispose();
    });

    it('keeps initial system notices in the snapshot and out of model history', async () => {
      const observed: any[][] = [];
      const definition = makeDefinition({
        initialMessages: [
          {
            id: 'system-note',
            role: 'system',
            text: 'Notice',
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      });
      const session = await createRuntimeFactory(async (_definition, messages) => {
        observed.push(messages);
        return { type: 'assistant_message', text: 'Done' };
      }).create(definition);
      await session.sendMessage('Hello');
      expect(observed[0]).toHaveLength(1);
      expect(observed[0][0]).toBeInstanceOf(HumanMessage);
      expect(observed[0][0]?.content).toBe('Hello');
      expect(session.getSnapshot().messages[0]).toMatchObject({
        id: 'system-note',
        role: 'system'
      });
    });

    it('retains one canonical history across repeated graph invocations', async () => {
      const seen: string[][] = [];
      const session = await createRuntimeFactory(async (_definition, messages) => {
        seen.push(messages.map((message) => `${message.getType()}:${String(message.content)}`));
        return { type: 'assistant_message', text: `answer-${seen.length}` };
      }).create(makeDefinition());
      await session.sendMessage('first');
      await session.sendMessage('second');
      expect(seen[1]).toEqual(['human:first', 'ai:answer-1', 'human:second']);
      expect(seen[1]).toHaveLength(3);
    });

    it('normalizes blank and duplicate provider IDs and pairs each result with its call', async () => {
      const modelHistories: any[][] = [];
      const outputs: AssistantRuntimeModelOutput[] = [
        {
          type: 'tool_call_request',
          text: 'Read both',
          toolCalls: [
            { id: '', name: 'first' },
            { id: 'duplicate', name: 'second' },
            { id: 'duplicate', name: 'third' }
          ]
        },
        { type: 'assistant_message', text: 'Done' }
      ];
      const session = await createRuntimeFactory(async (_definition, messages) => {
        modelHistories.push(messages);
        return outputs.shift()!;
      }).create(
        makeDefinition({
          tools: ['first', 'second', 'third'].map((name) => ({
            name,
            server: 's',
            tool: name,
            execute: async () => ({ name })
          })),
          approvalPolicy: () => 'automatic'
        })
      );
      await session.sendMessage('Read both');
      const calls = session.getSnapshot().pendingToolCalls;
      const request = modelHistories[1].find((message) =>
        AIMessage.isInstance(message) ? message.tool_calls : undefined
      )?.tool_calls;
      const results = modelHistories[1].filter((message) => ToolMessage.isInstance(message));
      expect(calls).toHaveLength(3);
      expect(calls.map((call) => call.id).every(Boolean)).toBe(true);
      expect(new Set(calls.map((call) => call.id)).size).toBe(3);
      expect(request.map((call: any) => call.id)).toEqual(calls.map((call) => call.id));
      expect(
        results.map((message) => [
          ToolMessage.isInstance(message) ? message.tool_call_id : undefined,
          message.name
        ])
      ).toEqual(calls.map((call) => [call.id, call.publicToolName]));
      expect(results.map((message) => JSON.parse(String(message.content)))).toEqual([
        { name: 'first' },
        { name: 'second' },
        { name: 'third' }
      ]);
    });

    it('returns isolated snapshots and makes disposal idempotent with no late events', async () => {
      let resolveTool!: (value: unknown) => void;
      let started!: () => void;
      const toolStarted = new Promise<void>((resolve) => (started = resolve));
      const events: unknown[] = [];
      const session = await createRuntimeFactory(async () => ({
        type: 'tool_call_request',
        text: 'Wait for tool',
        toolCalls: [{ id: 'slow-call', name: 'slow', arguments: { nested: { value: 1 } } }]
      })).create(
        makeDefinition({
          onEvent: (event) => events.push(event),
          tools: [
            {
              name: 'slow',
              server: 's',
              tool: 'slow',
              execute: async () => {
                started();
                return new Promise((resolve) => (resolveTool = resolve));
              }
            }
          ],
          approvalPolicy: () => 'local'
        })
      );
      const turn = session.sendMessage('Run slow tool');
      await toolStarted;
      const snapshot = session.getSnapshot();
      snapshot.messages[0]!.text = 'corrupted';
      (snapshot.pendingToolCalls[0]!.arguments as any).nested.value = 99;
      expect(session.getSnapshot().messages[0]!.text).not.toBe('corrupted');
      expect((session.getSnapshot().pendingToolCalls[0]!.arguments as any).nested.value).toBe(1);
      await session.dispose();
      const settled = session.getSnapshot();
      const eventCount = events.length;
      await session.dispose();
      resolveTool({ late: true });
      await expect(turn).rejects.toThrow();
      await Promise.resolve();
      expect(session.getSnapshot()).toEqual(settled);
      expect(events).toHaveLength(eventCount);
    });
    it('keeps validated local proposals private until the final assistant message', async () => {
      const histories: any[][] = [];
      let round = 0;
      const proposal = { prompt: { replacement: 'Revised', rationale: 'Clearer' } };
      const session = await createRuntimeFactory(async (_definition, messages) => {
        histories.push([...messages]);
        round += 1;
        return round === 1
          ? {
              type: 'tool_call_request',
              text: '',
              toolCalls: [{ id: 'proposal-1', name: 'propose', arguments: proposal }]
            }
          : { type: 'assistant_message', text: 'Here is the proposal.' };
      }).create(
        makeDefinition({
          tools: [
            {
              name: 'propose',
              server: 'local',
              tool: 'propose',
              execute: async (args) => args,
              extractProposal: (value) => value as any
            }
          ],
          approvalPolicy: () => 'local'
        })
      );

      const result = await session.sendMessage('Improve this scenario');
      expect(result).toMatchObject({ type: 'assistant_message', suggestions: proposal });
      expect(histories).toHaveLength(2);
      expect(histories[1].at(-1)).toBeInstanceOf(ToolMessage);
      expect(histories[1].at(-1)).toMatchObject({ tool_call_id: 'proposal-1' });
      expect(String(histories[1].at(-1).content)).not.toContain('assistant_message');
    });

    it('buffers a local proposal while a write waits for approval', async () => {
      const proposal = { evalRules: { replacement: [{ type: 'required_tool', value: 'search' }] } };
      let round = 0;
      const session = await createRuntimeFactory(async () => {
        round += 1;
        return round === 1
          ? {
              type: 'tool_call_request',
              text: 'Proposal and write',
              toolCalls: [
                { id: 'proposal', name: 'propose', arguments: proposal },
                { id: 'write', name: 'write' }
              ]
            }
          : { type: 'assistant_message', text: 'Ready to review.' };
      }).create(
        makeDefinition({
          tools: [
            {
              name: 'propose',
              server: 'local',
              tool: 'propose',
              execute: async (args) => args,
              extractProposal: (value) => value as any
            },
            { name: 'write', server: 's', tool: 'write', execute: async () => ({ ok: true }) }
          ],
          approvalPolicy: (name) => (name === 'propose' ? 'local' : 'approval_required')
        })
      );
      const pending = await session.sendMessage('Propose and write');
      expect(pending.type).toBe('tool_call_request');
      if (pending.type !== 'tool_call_request') throw new Error('Expected write approval');
      expect(pending.pendingToolCalls.map((call) => call.publicToolName)).toEqual(['write']);
      expect(session.getSnapshot().messages.at(-1)?.suggestions).toBeUndefined();
      const completed = await session.resolveToolCalls([
        { toolCallId: 'write', decision: 'approve' }
      ]);
      expect(completed).toMatchObject({ type: 'assistant_message', suggestions: proposal });
      expect(session.getSnapshot().messages.at(-1)?.suggestions).toEqual(proposal);
    });

    it('finishes local proposals and readonly tools without pausing for approval', async () => {
      const proposal = { extractRules: { replacement: [{ name: 'tag', pattern: 'TM\\d+' }] } };
      const read = vi.fn(async () => ({ result: 'read' }));
      let round = 0;
      const session = await createRuntimeFactory(async () => {
        round += 1;
        return round === 1
          ? {
              type: 'tool_call_request',
              text: '',
              toolCalls: [{ name: 'propose', arguments: proposal }, { name: 'read' }]
            }
          : { type: 'assistant_message', text: 'Finished.' };
      }).create(
        makeDefinition({
          tools: [
            {
              name: 'propose',
              server: 'local',
              tool: 'propose',
              execute: async (args) => args,
              extractProposal: (value) => value as any
            },
            { name: 'read', server: 's', tool: 'read', execute: read }
          ],
          approvalPolicy: (name) => (name === 'propose' ? 'local' : 'automatic')
        })
      );
      const result = await session.sendMessage('Propose and read');
      expect(result).toMatchObject({ type: 'assistant_message', suggestions: proposal });
      expect(read).toHaveBeenCalledOnce();
      expect(round).toBe(2);
    });

    it('returns invalid local proposal arguments as tool feedback for correction', async () => {
      const histories: any[][] = [];
      let round = 0;
      const session = await createRuntimeFactory(async (_definition, messages) => {
        histories.push([...messages]);
        round += 1;
        return round === 1
          ? {
              type: 'tool_call_request',
              text: '',
              toolCalls: [
                {
                  id: 'bad-proposal',
                  name: 'propose',
                  arguments: {
                    evalRules: { replacement: [{ type: 'agent_check', prompt: 'Check intent' }] }
                  }
                }
              ]
            }
          : { type: 'assistant_message', text: 'I will correct that.' };
      }).create(
        makeDefinition({
          tools: [
            {
              name: 'propose',
              server: 'local',
              tool: 'propose',
              execute: async (args) => validateScenarioAssistantProposal(args, new Map()),
              extractProposal: (value) => value as any
            }
          ],
          approvalPolicy: () => 'local'
        })
      );
      const result = await session.sendMessage('Suggest a check');
      expect(result).toMatchObject({ type: 'assistant_message', text: 'I will correct that.' });
      expect(JSON.parse(String(histories[1].at(-1).content))).toMatchObject({
        error: expect.stringContaining('evalRules.replacement[0].label')
      });
      expect(result).not.toHaveProperty('suggestions');
    });

    it('holds tool results until the full batch resolves and appends them in request order', async () => {
      const histories: BaseMessage[][] = [];
      const outputs: AssistantRuntimeModelOutput[] = [
        {
          type: 'tool_call_request',
          text: 'Reading both',
          toolCalls: [{ name: 'first' }, { name: 'second' }]
        },
        { type: 'assistant_message', text: 'Done' }
      ];
      const factory = createRuntimeFactory(async (_definition, messages) => {
        histories.push(messages);
        return outputs.shift()!;
      });
      const definition = makeDefinition({
        tools: [
          { name: 'first', server: 's', tool: 'first', execute: async () => ({ n: 1 }) },
          { name: 'second', server: 's', tool: 'second', execute: async () => ({ n: 2 }) }
        ],
        approvalPolicy: () => 'approval_required'
      });
      const session = await factory.create(definition);
      const request = await session.sendMessage('Read');
      if (request.type !== 'tool_call_request') throw new Error('Expected tool request');
      const [first, second] = request.pendingToolCalls;

      const partial = await session.resolveToolCalls([
        { toolCallId: second.id, decision: 'approve' }
      ]);
      expect(partial.type).toBe('tool_call_resolved');
      expect(histories).toHaveLength(1);

      await session.resolveToolCalls([{ toolCallId: first.id, decision: 'approve' }]);
      expect(histories[1].slice(-2)).toEqual([
        expect.objectContaining({ content: expect.stringContaining('"n":1') }),
        expect.objectContaining({ content: expect.stringContaining('"n":2') })
      ]);
    });

    it('executes the maximum three external calls and pairs all results before the next model request', async () => {
      const observed: Array<Array<any>> = [];
      const execute = vi.fn(async (args) => ({ args }));
      let round = 0;
      const session = await createRuntimeFactory(async (_definition, messages) => {
        observed.push([...messages]);
        round += 1;
        return round === 1
          ? {
              type: 'tool_call_request',
              text: 'Read all',
              toolCalls: [
                { id: 'a', name: 'read_a' },
                { id: 'b', name: 'read_b' },
                { id: 'c', name: 'read_c' }
              ]
            }
          : { type: 'assistant_message', text: 'Done' };
      }).create(
        makeDefinition({
          tools: ['read_a', 'read_b', 'read_c'].map((name) => ({
            name,
            server: 's',
            tool: name,
            execute
          })),
          approvalPolicy: () => 'automatic'
        })
      );
      await session.sendMessage('Read');
      expect(execute).toHaveBeenCalledTimes(3);
      const nextModelMessages = observed[1];
      const calls = nextModelMessages.flatMap(
        (message) => (AIMessage.isInstance(message) ? message.tool_calls : undefined) ?? []
      );
      const results = nextModelMessages.filter((message) => ToolMessage.isInstance(message));
      expect(
        results.map((message) =>
          ToolMessage.isInstance(message) ? message.tool_call_id : undefined
        )
      ).toEqual(calls.map((call: any) => call.id));
      expect(results).toHaveLength(3);
    });

    it('cancels a running tool promptly and ignores its late completion', async () => {
      let finishTool!: (value: unknown) => void;
      let started!: () => void;
      const toolStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const toolResult = new Promise<unknown>((resolve) => {
        finishTool = resolve;
      });
      const events: string[] = [];
      const session = await createRuntimeFactory(async () => ({
        type: 'tool_call_request',
        text: 'Working',
        toolCalls: [{ name: 'slow' }]
      })).create(
        makeDefinition({
          tools: [
            {
              name: 'slow',
              server: 's',
              tool: 'slow',
              execute: () => {
                started();
                return toolResult;
              }
            }
          ],
          approvalPolicy: () => 'automatic',
          onEvent: (event) => events.push(event.type)
        })
      );
      const controller = new AbortController();
      const turn = session.sendMessage('Wait', controller.signal);
      await toolStarted;
      controller.abort();
      await expect(turn).rejects.toThrow();
      const afterCancel = session.getSnapshot();
      expect(afterCancel.messages.filter((message) => message.role === 'tool')).toHaveLength(1);
      expect(afterCancel.pendingToolCalls[0]).toMatchObject({
        status: 'error',
        error: expect.stringContaining('outcome unknown')
      });
      finishTool({ completed: true });
      await Promise.resolve();
      expect(session.getSnapshot()).toEqual(afterCancel);
      const eventCount = events.length;
      await Promise.resolve();
      expect(events).toHaveLength(eventCount);
    });

    it('runs local and read-only calls immediately and pauses only the write for approval', async () => {
      const executions: string[] = [];
      const histories: Array<Array<any>> = [];
      const outputs: AssistantRuntimeModelOutput[] = [
        {
          type: 'tool_call_request',
          text: 'Prepare and write',
          toolCalls: [
            { id: 'local-1', name: 'propose', arguments: { prompt: { replacement: 'Revised' } } },
            { id: 'read-1', name: 'read' },
            { id: 'write-1', name: 'write' }
          ]
        },
        { type: 'assistant_message', text: 'Done' }
      ];
      const session = await createRuntimeFactory(async (_definition, messages) => {
        histories.push([...messages]);
        return outputs.shift()!;
      }).create(
        makeDefinition({
          tools: ['propose', 'read', 'write'].map((name) => ({
            name,
            server: 's',
            tool: name,
            execute: async (args) => {
              executions.push(name);
              return name === 'propose' ? args : { name };
            },
            ...(name === 'propose' ? { extractProposal: (value: unknown) => value as any } : {})
          })),
          approvalPolicy: (name) =>
            name === 'propose' ? 'local' : name === 'read' ? 'automatic' : 'approval_required'
        })
      );
      const request = await session.sendMessage('Do the work');
      expect(request).toMatchObject({ type: 'tool_call_request' });
      expect([...executions].sort()).toEqual(['propose', 'read']);
      if (request.type !== 'tool_call_request') throw new Error('Expected approval request');
      expect(request.pendingToolCalls.map((call) => call.id)).toEqual(['write-1']);

      await session.resolveToolCalls([{ toolCallId: 'write-1', decision: 'approve' }]);
      expect([...executions].sort()).toEqual(['propose', 'read', 'write']);
      expect(session.getSnapshot().messages.at(-1)?.suggestions).toEqual({
        prompt: { replacement: 'Revised' }
      });
      const history = histories[1];
      expect(
        history
          .filter((message) => ToolMessage.isInstance(message))
          .map((message) => (ToolMessage.isInstance(message) ? message.tool_call_id : undefined))
      ).toEqual(['local-1', 'read-1', 'write-1']);
    });

    it('applies edited arguments and records denial exactly once in model order', async () => {
      const observed: Array<Array<any>> = [];
      const execute = vi.fn(async (args) => ({ args }));
      const session = await createRuntimeFactory(async (_definition, messages) => {
        observed.push([...messages]);
        return observed.length === 1
          ? {
              type: 'tool_call_request',
              text: 'Two decisions',
              toolCalls: [
                { id: 'edit-me', name: 'write' },
                { id: 'deny-me', name: 'delete' }
              ]
            }
          : { type: 'assistant_message', text: 'Finished' };
      }).create(
        makeDefinition({
          tools: [
            { name: 'write', server: 's', tool: 'write', execute },
            { name: 'delete', server: 's', tool: 'delete', execute }
          ],
          approvalPolicy: () => 'approval_required'
        })
      );
      await session.sendMessage('Decide');
      await session.resolveToolCalls([
        { toolCallId: 'edit-me', decision: 'approve', arguments: { path: 'edited.md' } },
        { toolCallId: 'deny-me', decision: 'deny' }
      ]);
      expect(execute).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith({ path: 'edited.md' }, expect.any(AbortSignal));
      expect(session.getSnapshot().pendingToolCalls.map(({ id, status }) => [id, status])).toEqual([
        ['edit-me', 'approved'],
        ['deny-me', 'denied']
      ]);
      const results = observed[1].filter((message) => ToolMessage.isInstance(message));
      expect(
        results.map((message) =>
          ToolMessage.isInstance(message) ? message.tool_call_id : undefined
        )
      ).toEqual(['edit-me', 'deny-me']);
      expect(JSON.parse(String(results[1].content))).toMatchObject({ denied: true });
    });

    it('validates an entire decision batch before executing any call', async () => {
      for (const invalidDecisions of [
        [
          { toolCallId: 'a', decision: 'approve' },
          { toolCallId: 'a', decision: 'approve' }
        ],
        [
          { toolCallId: 'a', decision: 'approve' },
          { toolCallId: 'stale', decision: 'approve' }
        ]
      ] as const) {
        const execute = vi.fn(async () => ({ ok: true }));
        const session = await createRuntimeFactory(async (_definition, messages) =>
          messages.some((message) => AIMessage.isInstance(message))
            ? { type: 'assistant_message', text: 'Done' }
            : {
                type: 'tool_call_request',
                text: 'Choose',
                toolCalls: [
                  { id: 'a', name: 'first' },
                  { id: 'b', name: 'second' }
                ]
              }
        ).create(
          makeDefinition({
            tools: ['first', 'second'].map((name) => ({
              name,
              server: 's',
              tool: name,
              execute
            })),
            approvalPolicy: () => 'approval_required'
          })
        );
        await session.sendMessage('Decide');
        await expect(session.resolveToolCalls(invalidDecisions as never)).rejects.toMatchObject({
          statusCode: 409
        });
        expect(execute).not.toHaveBeenCalled();
        expect(session.getSnapshot().pendingToolCalls.map(({ status }) => status)).toEqual([
          'pending',
          'pending'
        ]);
        const result = await session.resolveToolCalls([
          { toolCallId: 'a', decision: 'approve' },
          { toolCallId: 'b', decision: 'approve' }
        ]);
        expect(result).toMatchObject({
          type: 'assistant_message',
          text: 'Done'
        });
        expect(execute).toHaveBeenCalledTimes(2);
      }
    });

    it('resolves unknown names individually while valid automatic siblings execute', async () => {
      const histories: Array<Array<any>> = [];
      const execute = vi.fn(async () => ({ ok: true }));
      const outputs: AssistantRuntimeModelOutput[] = [
        {
          type: 'tool_call_request',
          text: 'Read',
          toolCalls: [
            { id: 'unknown-1', name: 'missing' },
            { id: 'read-1', name: 'read' }
          ]
        },
        { type: 'assistant_message', text: 'Recovered' }
      ];
      const session = await createRuntimeFactory(async (_definition, messages) => {
        histories.push([...messages]);
        return outputs.shift()!;
      }).create(
        makeDefinition({
          tools: [{ name: 'read', server: 's', tool: 'read', execute }],
          approvalPolicy: () => 'automatic'
        })
      );
      await session.sendMessage('Read');
      const toolResults = histories[1].filter((message) => ToolMessage.isInstance(message));
      expect(
        toolResults.map((message) =>
          ToolMessage.isInstance(message) ? message.tool_call_id : undefined
        )
      ).toEqual(['unknown-1', 'read-1']);
      expect(JSON.parse(String(toolResults[0].content)).error).toMatch(
        /missing is not a valid tool/
      );
      expect(execute).toHaveBeenCalledOnce();
    });

    it('stops before model call 26 and starts a fresh next user turn with paired history', async () => {
      const observed: Array<Array<any>> = [];
      let round = 0;
      const execute = vi.fn(async () => ({ ok: true }));
      const session = await createRuntimeFactory(async (_definition, messages) => {
        observed.push([...messages]);
        round += 1;
        return round <= 25
          ? {
              type: 'tool_call_request',
              text: 'Again',
              toolCalls:
                round === 1
                  ? [
                      {
                        id: 'budget-proposal',
                        name: 'propose',
                        arguments: { prompt: { replacement: 'discard' } }
                      },
                      { id: `id-${round}`, name: 'read' }
                    ]
                  : [{ id: `id-${round}`, name: 'read' }]
            }
          : { type: 'assistant_message', text: 'Next turn works' };
      }).create(
        makeDefinition({
          tools: [
            {
              name: 'propose',
              server: 'local',
              tool: 'propose',
              execute: async (args) => args,
              extractProposal: (value) => value as any
            },
            { name: 'read', server: 's', tool: 'read', execute }
          ],
          approvalPolicy: (name) => (name === 'propose' ? 'local' : 'automatic')
        })
      );
      await expect(session.sendMessage('Keep looking')).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining('25 model-call limit')
      });
      // The limit is checked before each model call, so round 25's tool calls still run.
      expect(execute).toHaveBeenCalledTimes(25);
      const terminalHistory = session.getSnapshot();
      expect(terminalHistory.pendingToolCalls.at(-1)).toMatchObject({
        id: 'id-25',
        status: 'approved'
      });
      await session.sendMessage('Start again');
      expect(observed[25].at(-1)).toBeInstanceOf(HumanMessage);
      expect(observed[25].at(-1)?.content).toBe('Start again');
      expect(session.getSnapshot().messages.at(-1)?.suggestions).toBeUndefined();
      const messages = observed[25];
      const requestedIds = messages.flatMap(
        (message) =>
          (AIMessage.isInstance(message) ? message.tool_calls : undefined)?.map(
            (call: any) => call.id
          ) ?? []
      );
      const returnedIds = messages
        .filter((message) => ToolMessage.isInstance(message))
        .map((message) => (ToolMessage.isInstance(message) ? message.tool_call_id : undefined));
      expect(returnedIds).toEqual(requestedIds);
    });

    it('keeps the 25-round budget across a manual approval continuation', async () => {
      let round = 0;
      const write = vi.fn(async () => ({ written: true }));
      const read = vi.fn(async () => ({ read: true }));
      const session = await createRuntimeFactory(async () => {
        round += 1;
        return round === 1
          ? {
              type: 'tool_call_request',
              text: 'Write',
              toolCalls: [{ id: 'write-once', name: 'write' }]
            }
          : {
              type: 'tool_call_request',
              text: `Read ${round}`,
              toolCalls: [{ id: `read-${round}`, name: 'read' }]
            };
      }).create(
        makeDefinition({
          tools: [
            { name: 'write', server: 's', tool: 'write', execute: write },
            { name: 'read', server: 's', tool: 'read', execute: read }
          ],
          approvalPolicy: (name) => (name === 'write' ? 'approval_required' : 'automatic')
        })
      );
      const pending = await session.sendMessage('Start');
      if (pending.type !== 'tool_call_request') throw new Error('Expected write approval');
      await expect(
        session.resolveToolCalls([
          { toolCallId: pending.pendingToolCalls[0].id, decision: 'approve' }
        ])
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining('25 model-call limit')
      });
      expect(write).toHaveBeenCalledOnce();
      expect(read).toHaveBeenCalledTimes(24);
      expect(session.getSnapshot().pendingToolCalls.at(-1)).toMatchObject({
        id: 'read-25',
        status: 'approved'
      });
    });

    it('executes a three-call batch and preserves completed results when a sibling is cancelled', async () => {
      const observed: Array<Array<any>> = [];
      let finishSlow!: (value: unknown) => void;
      let slowStarted!: () => void;
      const slowStart = new Promise<void>((resolve) => {
        slowStarted = resolve;
      });
      const slowResult = new Promise<unknown>((resolve) => {
        finishSlow = resolve;
      });
      let modelCalls = 0;
      const finished = new Set<string>();
      let siblingsFinished!: () => void;
      const siblingsDone = new Promise<void>((resolve) => (siblingsFinished = resolve));
      const session = await createRuntimeFactory(async (_definition, messages) => {
        observed.push([...messages]);
        modelCalls += 1;
        return modelCalls === 1
          ? {
              type: 'tool_call_request',
              text: 'Three tools',
              toolCalls: [
                { id: 'one', name: 'one' },
                { id: 'two', name: 'two' },
                { id: 'three', name: 'three' }
              ]
            }
          : { type: 'assistant_message', text: 'Finished' };
      }).create(
        makeDefinition({
          tools: [
            { name: 'one', server: 's', tool: 'one', execute: async () => ({ completed: 'one' }) },
            {
              name: 'two',
              server: 's',
              tool: 'two',
              execute: () => {
                slowStarted();
                return slowResult;
              }
            },
            {
              name: 'three',
              server: 's',
              tool: 'three',
              execute: async () => ({ completed: 'three' })
            }
          ],
          approvalPolicy: () => 'automatic',
          onEvent: (event) => {
            if (event.type !== 'tool_call_resolved') return;
            finished.add(String(event.payload.pendingToolCallId));
            if (finished.has('one') && finished.has('three')) siblingsFinished();
          }
        })
      );
      const controller = new AbortController();
      const turn = session.sendMessage('Run three', controller.signal);
      // Tools run in parallel: cancel once the fast siblings have finished.
      await slowStart;
      await siblingsDone;
      controller.abort();
      await expect(turn).rejects.toThrow();
      const canceled = session.getSnapshot();
      expect(canceled.messages.filter((message) => message.role === 'tool')).toHaveLength(3);
      expect(canceled.pendingToolCalls.map((call) => call.status)).toEqual([
        'approved',
        'error',
        'approved'
      ]);
      finishSlow({ completed: 'late' });
      await session.sendMessage('Next');
      const pairedHistory = observed.at(-1)!;
      expect(
        pairedHistory
          .filter((message) => ToolMessage.isInstance(message))
          .map((message) => (ToolMessage.isInstance(message) ? message.tool_call_id : undefined))
      ).toEqual(expect.arrayContaining(['one', 'two', 'three']));
      expect(
        pairedHistory
          .filter(
            (message) =>
              AIMessage.isInstance(message) &&
              (AIMessage.isInstance(message) ? message.tool_calls : undefined)
          )
          .flatMap((message) =>
            AIMessage.isInstance(message) ? (message.tool_calls ?? []).map((call) => call.id) : []
          )
      ).toEqual(['one', 'two', 'three']);
    });

    it('discards proposals from a turn cancelled during a tool call', async () => {
      let finishTool!: (value: unknown) => void;
      let started!: () => void;
      const toolStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const toolResult = new Promise<unknown>((resolve) => {
        finishTool = resolve;
      });
      let modelCalls = 0;
      const session = await createRuntimeFactory(async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? {
              type: 'tool_call_request',
              text: 'Working',
              toolCalls: [
                { name: 'propose', arguments: { prompt: { replacement: 'new prompt' } } },
                { name: 'slow' }
              ]
            }
          : { type: 'assistant_message', text: 'Fresh turn' };
      }).create(
        makeDefinition({
          assistant: 'scenario',
          tools: [
            {
              name: 'propose',
              server: 'local',
              tool: 'propose',
              execute: async (args) => args,
              extractProposal: (value) => value as any
            },
            {
              name: 'slow',
              server: 's',
              tool: 'slow',
              execute: () => {
                started();
                return toolResult;
              }
            }
          ],
          approvalPolicy: (name) => (name === 'propose' ? 'local' : 'automatic')
        })
      );
      const controller = new AbortController();
      const turn = session.sendMessage('Propose and read', controller.signal);
      await toolStarted;
      controller.abort();
      await expect(turn).rejects.toThrow();
      expect(
        session.getSnapshot().messages.find((message) => AIMessage.isInstance(message))?.suggestions
      ).toBeUndefined();
      finishTool({ ok: true });
      await session.sendMessage('New turn');
      expect(session.getSnapshot().messages.at(-1)).toMatchObject({
        role: 'assistant',
        text: 'Fresh turn'
      });
      expect(session.getSnapshot().messages.at(-1)?.suggestions).toBeUndefined();
    });

    it('pairs a paused batch before a superseding user message', async () => {
      const histories: Array<Array<any>> = [];
      let round = 0;
      const session = await createRuntimeFactory(async (_definition, messages) => {
        histories.push([...messages]);
        round += 1;
        return round === 1
          ? {
              type: 'tool_call_request',
              text: 'Paused',
              toolCalls: [
                {
                  id: 'old-proposal',
                  name: 'propose',
                  arguments: { prompt: { replacement: 'discard' } }
                },
                { id: 'old-call', name: 'write' }
              ]
            }
          : { type: 'assistant_message', text: 'New turn answer' };
      }).create(
        makeDefinition({
          tools: [
            {
              name: 'propose',
              server: 'local',
              tool: 'propose',
              execute: async (args) => args,
              extractProposal: (value) => value as any
            },
            { name: 'write', server: 's', tool: 'write', execute: async () => ({ ok: true }) }
          ],
          approvalPolicy: (name) => (name === 'propose' ? 'local' : 'approval_required')
        })
      );
      await session.sendMessage('Old turn');
      await session.sendMessage('New turn');
      expect(histories[1].slice(-2)).toEqual([
        expect.objectContaining({ tool_call_id: 'old-call' }),
        expect.objectContaining({ content: 'New turn' })
      ]);
      expect(session.getSnapshot().pendingToolCalls[0]).toMatchObject({
        id: 'old-proposal',
        status: 'approved'
      });
      expect(session.getSnapshot().messages.at(-1)?.suggestions).toBeUndefined();
      expect(session.getSnapshot().pendingToolCalls[1]).toMatchObject({
        id: 'old-call',
        status: 'denied',
        error: expect.stringContaining('superseded')
      });
    });

    it('cleans paired calls and discards proposals after an unrecoverable model failure', async () => {
      const histories: Array<Array<any>> = [];
      let round = 0;
      const session = await createRuntimeFactory(async (_definition, messages) => {
        histories.push([...messages]);
        round += 1;
        if (round === 1)
          return {
            type: 'tool_call_request',
            text: 'Will fail',
            toolCalls: [
              {
                id: 'failed-turn-proposal',
                name: 'propose',
                arguments: { prompt: { replacement: 'discard me' } }
              },
              { id: 'failed-turn-call', name: 'read' }
            ]
          };
        throw new Error('provider unavailable');
      }).create(
        makeDefinition({
          assistant: 'scenario',
          tools: [
            {
              name: 'propose',
              server: 'local',
              tool: 'propose',
              execute: async (args) => args,
              extractProposal: (value) => value as any
            },
            { name: 'read', server: 's', tool: 'read', execute: async () => ({ ok: true }) }
          ],
          approvalPolicy: (name) => (name === 'propose' ? 'local' : 'approval_required')
        })
      );
      const request = await session.sendMessage('Read then answer');
      if (request.type !== 'tool_call_request') throw new Error('Expected tool request');
      await expect(
        session.resolveToolCalls([{ toolCallId: 'failed-turn-call', decision: 'approve' }])
      ).rejects.toThrow('provider unavailable');
      expect(histories[1].slice(-1)).toEqual([
        expect.objectContaining({ tool_call_id: 'failed-turn-call' })
      ]);
      expect(session.getSnapshot().messages.at(-1)?.suggestions).toBeUndefined();
      expect(session.getSnapshot().pendingToolCalls[0].status).toBe('approved');
    });

    it('pairs an approved tool result before asking the model to continue', async () => {
      const histories: BaseMessage[][] = [];
      const execute = vi.fn(async () => ({ ok: true }));
      const outputs: AssistantRuntimeModelOutput[] = [
        {
          type: 'tool_call_request',
          text: 'Reading',
          toolCalls: [{ name: 'read', arguments: { q: 1 } }]
        },
        { type: 'assistant_message', text: 'Done' }
      ];
      const factory = createRuntimeFactory(async (_definition, messages) => {
        histories.push(messages);
        return outputs.shift()!;
      });
      const definition: AssistantRuntimeDefinition = {
        assistant: 'result',
        agent: { provider: 'openai', model: 'test' },
        context: {
          scope: 'all_runs',
          runId: null,
          resultSummary: null,
          referenceReportsForRun: []
        },
        getSystemPrompt: () => 'Prompt',
        tools: [{ name: 'read', server: 'mcplab', tool: 'read', execute }],
        approvalPolicy: () => 'approval_required'
      };

      const session = await factory.create(definition);
      const pending = await session.sendMessage('Find it');
      expect(pending.type).toBe('tool_call_request');
      if (pending.type !== 'tool_call_request') throw new Error('Expected tool request');
      const resolved = await session.resolveToolCalls([
        { toolCallId: pending.pendingToolCalls[0].id, decision: 'approve' }
      ]);

      expect(resolved).toMatchObject({ type: 'assistant_message', text: 'Done' });
      expect(execute).toHaveBeenCalledWith({ q: 1 }, expect.any(AbortSignal));
      expect(histories[1].at(-1)).toBeInstanceOf(ToolMessage);
      expect(String(histories[1].at(-1)?.content)).toContain('ok');
      expect(session.getSnapshot().pendingToolCalls[0].status).toBe('approved');
    });

    it('sends the stored truncated preview to later model rounds', async () => {
      const histories: BaseMessage[][] = [];
      const longValue = 'x'.repeat(10_000);
      const outputs: AssistantRuntimeModelOutput[] = [
        { type: 'tool_call_request', text: 'Reading', toolCalls: [{ id: 'large', name: 'read' }] },
        { type: 'assistant_message', text: 'Done' },
        { type: 'assistant_message', text: 'Still done' }
      ];
      const session = await createRuntimeFactory(async (_definition, messages) => {
        histories.push(messages);
        return outputs.shift()!;
      }).create(
        makeDefinition({
          tools: [{ name: 'read', server: 's', tool: 'read', execute: async () => longValue }],
          approvalPolicy: () => 'approval_required'
        })
      );
      const pending = await session.sendMessage('Read');
      if (pending.type !== 'tool_call_request') throw new Error('Expected tool request');
      await session.resolveToolCalls([{ toolCallId: 'large', decision: 'approve' }]);

      const expectedPreview = (await import('../src/app-server/assistant-common.js')).truncateJson(
        longValue,
        4000
      );
      expect(histories[1].at(-1)).toMatchObject({
        tool_call_id: 'large',
        content: expectedPreview
      });
      expect(String(histories[1].at(-1)?.content).length).toBeLessThan(longValue.length);
      await session.sendMessage('Continue');
      const largeResult = histories[2].find(
        (message) => ToolMessage.isInstance(message) && message.tool_call_id === 'large'
      );
      expect(largeResult).toBeInstanceOf(ToolMessage);
      expect(String(largeResult?.content)).toBe(expectedPreview);
    });
  });
}

function makeDefinition(
  overrides: Partial<AssistantRuntimeDefinition> = {}
): AssistantRuntimeDefinition {
  return {
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'approval_required',
    ...overrides
  };
}
