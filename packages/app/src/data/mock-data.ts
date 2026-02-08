import type { EvalConfig, EvalResult } from '@/types/eval';

export const mockConfigs: EvalConfig[] = [
  {
    id: 'cfg-001',
    name: 'Basic OpenAI Eval',
    description: 'Simple evaluation of GPT-4o with filesystem tools',
    servers: [
      {
        id: 'srv-1',
        name: 'Filesystem MCP',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        authType: 'none'
      }
    ],
    agents: [
      {
        id: 'agt-1',
        name: 'GPT-4o',
        provider: 'openai',
        model: 'gpt-4o',
        temperature: 0,
        maxTokens: 4096
      }
    ],
    scenarios: [
      {
        id: 'scn-1',
        name: 'List directory',
        agentId: 'agt-1',
        serverIds: ['srv-1'],
        prompt: 'List all files in the /tmp directory',
        testMode: 'total',
        steps: [],
        evalRules: [{ type: 'required_tool', value: 'list_directory' }],
        extractRules: [{ name: 'fileCount', pattern: '\\d+ files' }]
      },
      {
        id: 'scn-2',
        name: 'Read file',
        agentId: 'agt-1',
        serverIds: ['srv-1'],
        prompt: 'Read the contents of /tmp/test.txt',
        testMode: 'total',
        steps: [],
        evalRules: [
          { type: 'required_tool', value: 'read_file' },
          { type: 'forbidden_tool', value: 'write_file' }
        ],
        extractRules: []
      }
    ],
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-02-01T14:30:00Z'
  },
  {
    id: 'cfg-002',
    name: 'Multi-Agent Comparison',
    description: 'Compare GPT-4o vs Claude on web search tasks',
    servers: [
      {
        id: 'srv-2',
        name: 'Brave Search MCP',
        transport: 'sse',
        url: 'http://localhost:3001/sse',
        authType: 'bearer',
        authValue: 'sk-xxx'
      }
    ],
    agents: [
      {
        id: 'agt-2',
        name: 'GPT-4o',
        provider: 'openai',
        model: 'gpt-4o',
        temperature: 0.1,
        maxTokens: 4096
      },
      {
        id: 'agt-3',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        temperature: 0,
        maxTokens: 4096
      }
    ],
    scenarios: [
      {
        id: 'scn-3',
        name: 'Web search',
        agentId: 'agt-2',
        serverIds: ['srv-2'],
        prompt: 'Search for the latest TypeScript release version',
        testMode: 'total',
        steps: [],
        evalRules: [
          { type: 'required_tool', value: 'brave_web_search' },
          { type: 'response_contains', value: 'TypeScript' }
        ],
        extractRules: [{ name: 'version', pattern: '\\d+\\.\\d+\\.\\d+' }]
      },
      {
        id: 'scn-4',
        name: 'Web search (Claude)',
        agentId: 'agt-3',
        serverIds: ['srv-2'],
        prompt: 'Search for the latest TypeScript release version',
        testMode: 'total',
        steps: [],
        evalRules: [
          { type: 'required_tool', value: 'brave_web_search' },
          { type: 'response_contains', value: 'TypeScript' }
        ],
        extractRules: [{ name: 'version', pattern: '\\d+\\.\\d+\\.\\d+' }]
      }
    ],
    createdAt: '2025-01-20T08:00:00Z',
    updatedAt: '2025-01-28T16:45:00Z'
  },
  {
    id: 'cfg-003',
    name: 'Database Operations',
    description: 'Test PostgreSQL MCP server tool usage',
    servers: [
      {
        id: 'srv-3',
        name: 'PostgreSQL MCP',
        transport: 'streamable-http',
        url: 'http://localhost:3002/mcp',
        authType: 'api-key',
        authValue: 'key-xxx'
      }
    ],
    agents: [
      {
        id: 'agt-4',
        name: 'GPT-4o-mini',
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0,
        maxTokens: 2048
      }
    ],
    scenarios: [
      {
        id: 'scn-5',
        name: 'Query users',
        agentId: 'agt-4',
        serverIds: ['srv-3'],
        prompt: 'List all users in the database',
        testMode: 'total',
        steps: [],
        evalRules: [{ type: 'required_tool', value: 'query' }],
        extractRules: [{ name: 'userCount', pattern: '\\d+ users?' }]
      }
    ],
    createdAt: '2025-02-01T12:00:00Z',
    updatedAt: '2025-02-03T09:15:00Z'
  }
];

function makeRuns(passed: boolean[], toolNames: string[][]): EvalResult['scenarios'][0]['runs'] {
  return passed.map((p, i) => ({
    runIndex: i,
    passed: p,
    toolCalls: toolNames[i].map((name, j) => ({
      name,
      arguments: {},
      duration: Math.floor(Math.random() * 2000) + 200,
      timestamp: new Date(Date.now() - (toolNames[i].length - j) * 1000).toISOString()
    })),
    finalAnswer: p ? 'Task completed successfully.' : 'I was unable to complete the task.',
    conversation: [],
    duration: Math.floor(Math.random() * 5000) + 1000,
    extractedValues: {},
    failureReasons: p ? [] : ['Required tool not called']
  }));
}

export const mockResults: EvalResult[] = [
  {
    id: 'run-a1b2c3',
    configId: 'cfg-001',
    configHash: 'e3b0c44298fc',
    timestamp: '2025-02-05T14:30:00Z',
    overallPassRate: 0.875,
    totalScenarios: 2,
    totalRuns: 8,
    avgToolCalls: 2.1,
    avgLatency: 1450,
    scenarios: [
      {
        scenarioId: 'scn-1',
        scenarioName: 'List directory',
        agentId: 'agt-1',
        agentName: 'GPT-4o',
        passRate: 1.0,
        avgToolCalls: 1.5,
        avgDuration: 1200,
        runs: makeRuns(
          [true, true, true, true],
          [
            ['list_directory'],
            ['list_directory', 'list_directory'],
            ['list_directory'],
            ['list_directory']
          ]
        )
      },
      {
        scenarioId: 'scn-2',
        scenarioName: 'Read file',
        agentId: 'agt-1',
        agentName: 'GPT-4o',
        passRate: 0.75,
        avgToolCalls: 2.7,
        avgDuration: 1700,
        runs: makeRuns(
          [true, true, true, false],
          [
            ['read_file'],
            ['read_file', 'list_directory'],
            ['read_file'],
            ['list_directory', 'write_file']
          ]
        )
      }
    ]
  },
  {
    id: 'run-d4e5f6',
    configId: 'cfg-002',
    configHash: 'a1b2c3d4e5f6',
    timestamp: '2025-02-04T10:15:00Z',
    overallPassRate: 0.667,
    totalScenarios: 2,
    totalRuns: 6,
    avgToolCalls: 3.2,
    avgLatency: 2100,
    scenarios: [
      {
        scenarioId: 'scn-3',
        scenarioName: 'Web search',
        agentId: 'agt-2',
        agentName: 'GPT-4o',
        passRate: 1.0,
        avgToolCalls: 2.0,
        avgDuration: 1800,
        runs: makeRuns(
          [true, true, true],
          [
            ['brave_web_search', 'brave_web_search'],
            ['brave_web_search'],
            ['brave_web_search', 'brave_web_search']
          ]
        )
      },
      {
        scenarioId: 'scn-4',
        scenarioName: 'Web search (Claude)',
        agentId: 'agt-3',
        agentName: 'Claude 3.5 Sonnet',
        passRate: 0.333,
        avgToolCalls: 4.3,
        avgDuration: 2400,
        runs: makeRuns(
          [false, true, false],
          [['brave_web_search'], ['brave_web_search', 'brave_web_search'], ['brave_web_search']]
        )
      }
    ]
  },
  {
    id: 'run-g7h8i9',
    configId: 'cfg-001',
    configHash: 'e3b0c44298fc',
    timestamp: '2025-02-03T08:45:00Z',
    overallPassRate: 1.0,
    totalScenarios: 2,
    totalRuns: 4,
    avgToolCalls: 1.8,
    avgLatency: 1100,
    scenarios: [
      {
        scenarioId: 'scn-1',
        scenarioName: 'List directory',
        agentId: 'agt-1',
        agentName: 'GPT-4o',
        passRate: 1.0,
        avgToolCalls: 1.0,
        avgDuration: 900,
        runs: makeRuns([true, true], [['list_directory'], ['list_directory']])
      },
      {
        scenarioId: 'scn-2',
        scenarioName: 'Read file',
        agentId: 'agt-1',
        agentName: 'GPT-4o',
        passRate: 1.0,
        avgToolCalls: 2.5,
        avgDuration: 1300,
        runs: makeRuns([true, true], [['read_file', 'read_file'], ['read_file']])
      }
    ]
  },
  {
    id: 'run-j0k1l2',
    configId: 'cfg-003',
    configHash: 'f6e5d4c3b2a1',
    timestamp: '2025-02-02T16:00:00Z',
    overallPassRate: 0.5,
    totalScenarios: 1,
    totalRuns: 4,
    avgToolCalls: 1.5,
    avgLatency: 980,
    scenarios: [
      {
        scenarioId: 'scn-5',
        scenarioName: 'Query users',
        agentId: 'agt-4',
        agentName: 'GPT-4o-mini',
        passRate: 0.5,
        avgToolCalls: 1.5,
        avgDuration: 980,
        runs: makeRuns(
          [true, false, true, false],
          [['query'], ['list_tables'], ['query', 'query'], ['list_tables']]
        )
      }
    ]
  },
  {
    id: 'run-m3n4o5',
    configId: 'cfg-002',
    configHash: 'a1b2c3d4e5f6',
    timestamp: '2025-01-30T12:00:00Z',
    overallPassRate: 0.833,
    totalScenarios: 2,
    totalRuns: 6,
    avgToolCalls: 2.5,
    avgLatency: 1950,
    scenarios: [
      {
        scenarioId: 'scn-3',
        scenarioName: 'Web search',
        agentId: 'agt-2',
        agentName: 'GPT-4o',
        passRate: 1.0,
        avgToolCalls: 2.0,
        avgDuration: 1700,
        runs: makeRuns(
          [true, true, true],
          [['brave_web_search'], ['brave_web_search', 'brave_web_search'], ['brave_web_search']]
        )
      },
      {
        scenarioId: 'scn-4',
        scenarioName: 'Web search (Claude)',
        agentId: 'agt-3',
        agentName: 'Claude 3.5 Sonnet',
        passRate: 0.667,
        avgToolCalls: 3.0,
        avgDuration: 2200,
        runs: makeRuns(
          [true, true, false],
          [['brave_web_search', 'brave_web_search'], ['brave_web_search'], ['brave_web_search']]
        )
      }
    ]
  }
];
