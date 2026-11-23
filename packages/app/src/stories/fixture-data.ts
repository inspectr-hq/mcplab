import type { EvalConfig, EvalResult, Scenario } from '@/types/eval';
import type {
  EvalDataSource,
  QueueResponse,
  RunQueueSseEvent,
  WorkspaceRunSummary
} from '@/lib/data-sources/types';
import cliPackage from '../../../cli/package.json';

const date = '2026-11-23T07:53:55.494Z';
export const demoVersion = cliPackage.version;

export const demoScenario: Scenario = {
  id: 'check-weather',
  name: 'Check Weather',
  serverIds: ['weather-mcp'],
  prompt:
    "I'm planning a trip to Paris next week. What's the current weather like there, and can you give me a 5-day forecast? Based on the weather, what should I pack?",
  evalRules: [
    { type: 'required_tool', value: 'get_current_weather' },
    { type: 'required_tool', value: 'get_forecast' },
    { type: 'forbidden_tool', value: 'get_weather_alerts' },
    { type: 'tool_input_contains', tool: 'get_current_weather', value: 'Paris' },
    { type: 'tool_input_jsonpath', tool: 'get_forecast', path: '$.location', equals: 'Paris' },
    { type: 'tool_input_jsonpath', tool: 'get_forecast', path: '$.days', equals: 5 },
    { type: 'response_regex', value: 'Paris' },
    { type: 'response_regex', value: '°C' },
    { type: 'response_regex', value: 'pack' },
    { type: 'response_contains', value: 'Paris' }
  ],
  extractRules: [
    { name: 'current_temperature', pattern: '(\\d+)°C' },
    { name: 'forecast_days', pattern: '(\\d)-Day Forecast|forecast.*?(\\d) day' },
    { name: 'city_mentioned', pattern: '(Paris)' }
  ]
};

const relatedScenarios: Scenario[] = [
  {
    id: 'current-weather-london',
    name: 'Get current weather for London',
    serverIds: ['weather-mcp'],
    prompt: 'What is the current weather in London? Include temperature and a short summary.',
    evalRules: [
      { type: 'response_contains', value: 'London' },
      { type: 'response_regex', value: '\\d+' }
    ],
    extractRules: []
  },
  {
    id: 'weather-paris',
    name: 'Get weather for Paris',
    serverIds: ['weather-mcp'],
    prompt: 'Provide the current weather for Paris in a concise format.',
    evalRules: [{ type: 'response_contains', value: 'Paris' }],
    extractRules: []
  },
  {
    id: 'compare-weather',
    name: 'Compare weather between New York and San Francisco',
    serverIds: ['weather-mcp'],
    prompt: 'Compare the current weather in New York and San Francisco.',
    evalRules: [
      { type: 'response_contains', value: 'New York' },
      { type: 'response_contains', value: 'San Francisco' }
    ],
    extractRules: []
  }
];

const demoAgent = {
  id: 'azure-gpt-6-luna',
  name: 'azure-gpt-6-luna',
  provider: 'azure' as const,
  model: 'gpt-6-luna',
  temperature: 0,
  maxTokens: 2048
};
const claudeHaikuAgent = {
  id: 'claude-haiku-55',
  name: 'Claude Haiku 5.5',
  provider: 'anthropic' as const,
  model: 'claude-haiku-5-5',
  temperature: 0,
  maxTokens: 2048
};
export const demoAgents = [claudeHaikuAgent, { ...demoAgent, name: 'GPT-6 Luna' }];

export const demoConfig: EvalConfig = {
  id: 'config-demo',
  name: 'Weather MCP Evaluation',
  relativePath: 'weather-mcp-evaluation.yaml',
  sourcePath: '/workspace/mcplab/evals/weather-mcp-evaluation.yaml',
  agents: [claudeHaikuAgent],
  scenarios: [demoScenario],
  createdAt: date,
  updatedAt: date
};

export const demoConfigSuite: EvalConfig = {
  id: 'config-weather-suite',
  name: 'Weather MCP Evaluation Suite',
  relativePath: 'weather-mcp-eval-1.yaml',
  sourcePath: '/workspace/mcplab/evals/weather-mcp-eval-1.yaml',
  agents: [claudeHaikuAgent],
  scenarios: relatedScenarios,
  createdAt: date,
  updatedAt: date
};

const finalAnswer = [
  "Paris is currently cool and damp. Right now it's about 11°C, feeling closer to 8°C because of wind and light rain. Winds are around 20 km/h, so it will likely feel chilly when you're walking around outdoors.",
  '',
  'The 5-day forecast looks very consistent:',
  '- Daily highs around 13°C',
  '- Night lows around 8°C',
  '- Light rain expected most days',
  '- Mild but cloudy and wet overall',
  '',
  "Based on that weather, I'd pack for cool, rainy autumn conditions rather than winter cold. A good setup would be:",
  '- A waterproof jacket or trench coat',
  '- Comfortable waterproof walking shoes or boots',
  '- Layers such as sweaters, long-sleeve shirts, and light thermals',
  '- Jeans or other long pants',
  '- A compact umbrella',
  '- A scarf, especially for evenings and windy days',
  '- A small day bag that can handle light rain',
  '',
  "You probably won't need heavy winter gear like a thick parka, gloves, or snow boots unless you get cold very easily. Since Paris usually involves a lot of walking, comfortable weather-resistant footwear will make a big difference."
].join('\n');

const currentWeather = [
  'Current Weather: Paris, France',
  'Condition: Light rain',
  'Temperature: 11°C (feels like 8°C)',
  'Humidity: 78%',
  'Wind: 20 km/h SW'
].join('\n');

const forecast = [
  '5-Day Forecast: Paris, France',
  '2026-11-23: Light rain, 13°C / 8°C',
  '2026-11-24: Light rain, 13°C / 8°C',
  '2026-11-25: Light rain, 13°C / 8°C',
  '2026-11-26: Light rain, 13°C / 8°C',
  '2026-11-27: Light rain, 13°C / 8°C'
].join('\n');

const runId = '20261123-085348-013';
const requestId = 'mcplab-run:20261123-085348-062:check-weather:azure-gpt-6-luna:run1';
const checkResults = [
  ['forbidden_tool', 'Forbidden tool · get_weather_alerts'],
  ['required_tool', 'Required tool · get_current_weather'],
  ['required_tool', 'Required tool · get_forecast'],
  ['tool_input_contains', 'Tool input · get_current_weather contains Paris'],
  ['tool_input_jsonpath', 'Tool input · get_forecast JSONPath $.location == Paris'],
  ['tool_input_jsonpath', 'Tool input · get_forecast JSONPath $.days == 5'],
  ['response_regex', 'Text matches regex · Paris'],
  ['response_regex', 'Text matches regex · °C'],
  ['response_regex', 'Text matches regex · pack'],
  ['response_contains', 'Text contains · Paris']
] as const;

export const demoResult: EvalResult = {
  id: runId,
  configId: demoConfig.id,
  configHash: 'aee8431605a57148f1d2d7192c10a39c378c702a77c0894df1b3ef3eddbb0468',
  configPath: demoConfig.sourcePath,
  configName: demoConfig.name,
  timestamp: date,
  mcpServerVersions: { 'weather-mcp': '1.0.0' },
  scenarios: [
    {
      scenarioId: demoScenario.id,
      scenarioName: demoScenario.name,
      agentId: demoAgent.id,
      agentName: demoAgent.name,
      provider: 'azure_openai',
      model: demoAgent.model,
      runs: [
        {
          runIndex: 0,
          requestId,
          passed: true,
          outcome: 'passed',
          toolCalls: [
            {
              name: 'get_current_weather',
              arguments: { location: 'Paris' },
              result: currentWeather,
              duration: 14,
              timestamp: '2026-11-23T07:53:51.180Z'
            },
            {
              name: 'get_forecast',
              arguments: { location: 'Paris', days: 5 },
              result: forecast,
              duration: 5,
              timestamp: '2026-11-23T07:53:51.194Z'
            }
          ],
          finalAnswer,
          conversation: [
            {
              id: 'user-1',
              kind: 'user_prompt',
              text: demoScenario.prompt,
              timestamp: '2026-11-23T07:53:48.125Z'
            },
            {
              id: 'assistant-1',
              kind: 'assistant_thought',
              text: 'I will check both the current conditions and a 5-day forecast for Paris so I can tailor the packing advice.',
              timestamp: '2026-11-23T07:53:51.180Z'
            },
            {
              id: 'tool-1',
              kind: 'tool_call',
              toolName: 'get_current_weather',
              text: JSON.stringify({ location: 'Paris' }),
              timestamp: '2026-11-23T07:53:51.180Z'
            },
            {
              id: 'tool-result-1',
              kind: 'tool_result',
              toolName: 'get_current_weather',
              text: currentWeather,
              ok: true,
              durationMs: 14,
              timestamp: '2026-11-23T07:53:51.194Z'
            },
            {
              id: 'tool-2',
              kind: 'tool_call',
              toolName: 'get_forecast',
              text: JSON.stringify({ location: 'Paris', days: 5 }),
              timestamp: '2026-11-23T07:53:51.194Z'
            },
            {
              id: 'tool-result-2',
              kind: 'tool_result',
              toolName: 'get_forecast',
              text: forecast,
              ok: true,
              durationMs: 5,
              timestamp: '2026-11-23T07:53:51.199Z'
            },
            {
              id: 'assistant-final',
              kind: 'assistant_final',
              text: finalAnswer,
              timestamp: '2026-11-23T07:53:55.023Z'
            }
          ],
          duration: 6898,
          extractedValues: { current_temperature: '11', city_mentioned: 'Paris' },
          failureReasons: [],
          checkResults: checkResults.map(([type, label]) => ({ type, label, status: 'passed' as const }))
        }
      ],
      passRate: 1,
      avgToolCalls: 2,
      avgDuration: 6898,
      checkCounts: { passed: 10, failed: 0, not_evaluated: 0, total: 10 }
    }
  ],
  overallPassRate: 1,
  totalScenarios: 1,
  totalRuns: 1,
  avgToolCalls: 2,
  avgLatency: 9.5,
  totalDurationMs: 6898,
  totalToolDurationMs: 19,
  outcomes: { passed: 1 },
  executionSource: 'mcplab',
  evaluationRunId: runId,
  checkCounts: { passed: 10, failed: 0, not_evaluated: 0, total: 10 }
};

const makeRelatedResult = (
  scenario: Scenario,
  id: string,
  timestamp: string,
  answer: string,
  toolCalls: EvalResult['scenarios'][number]['runs'][number]['toolCalls'],
  duration: number,
  agent = demoAgent
): EvalResult => {
  const baseScenario = demoResult.scenarios[0];
  const baseRun = baseScenario.runs[0];
  const checkResults = scenario.evalRules.map((rule) => ({
    type: rule.type,
    label: `${rule.type.replaceAll('_', ' ')} · ${String(rule.value)}`,
    status: 'passed' as const
  }));
  const checksPassed = checkResults.length;

  return {
    ...demoResult,
    id,
    configId: demoConfigSuite.id,
    configHash: 'weather-suite-fixture-hash',
    configPath: demoConfigSuite.sourcePath,
    configName: demoConfigSuite.name,
    timestamp,
    scenarios: [
      {
        ...baseScenario,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        agentId: agent.id,
        agentName: agent.name,
        provider: agent.provider === 'azure' ? 'azure_openai' : agent.provider,
        model: agent.model,
        runs: [
          {
            ...baseRun,
            requestId: id + ':run1',
            passed: true,
            toolCalls,
            finalAnswer: answer,
            conversation: [
              { id: id + ':user', kind: 'user_prompt', text: scenario.prompt },
              ...toolCalls.flatMap((call, index) => [
                {
                  id: id + ':call-' + index,
                  kind: 'tool_call' as const,
                  toolName: call.name,
                  text: JSON.stringify(call.arguments)
                },
                {
                  id: id + ':result-' + index,
                  kind: 'tool_result' as const,
                  toolName: call.name,
                  text: String(call.result),
                  ok: true
                }
              ]),
              { id: id + ':answer', kind: 'assistant_final', text: answer }
            ],
            duration,
            extractedValues: {},
            failureReasons: [],
            checkResults
          }
        ],
        passRate: 1,
        avgToolCalls: toolCalls.length,
        avgDuration: duration,
        checkCounts: { passed: checksPassed, failed: 0, not_evaluated: 0, total: checksPassed }
      }
    ],
    totalScenarios: 1,
    totalRuns: 1,
    avgToolCalls: toolCalls.length,
    avgLatency: duration,
    totalDurationMs: duration,
    outcomes: { passed: 1 },
    evaluationRunId: id,
    checkCounts: { passed: checksPassed, failed: 0, not_evaluated: 0, total: checksPassed }
  };
};

const londonScenario = relatedScenarios[0];
const comparisonScenario = relatedScenarios[2];
const londonResult = makeRelatedResult(
  londonScenario,
  'weather-run-london-001',
  '2026-11-22T10:15:00.000Z',
  'London is currently 9°C with cloudy skies and a light breeze.',
  [
    {
      name: 'get_current_weather',
      arguments: { location: 'London' },
      result: 'Current Weather: London, UK. Cloudy, 9°C, wind 12 km/h.',
      duration: 11,
      timestamp: '2026-11-22T10:14:55.000Z'
    }
  ],
  4200,
  claudeHaikuAgent
);
const parisResult = makeRelatedResult(
  relatedScenarios[1],
  'weather-run-paris-001',
  '2026-11-21T09:30:00.000Z',
  'Paris is currently 11°C with light rain and winds around 20 km/h.',
  [
    {
      name: 'get_current_weather',
      arguments: { location: 'Paris' },
      result: 'Current Weather: Paris, France. Light rain, 11°C, wind 20 km/h.',
      duration: 14,
      timestamp: '2026-11-21T09:29:54.000Z'
    }
  ],
  3900,
  claudeHaikuAgent
);
const comparisonResult = makeRelatedResult(
  comparisonScenario,
  'weather-run-comparison-001',
  '2026-11-21T09:40:00.000Z',
  'New York is 12°C and sunny, while San Francisco is 17°C with coastal clouds.',
  [
    {
      name: 'get_current_weather',
      arguments: { location: 'New York' },
      result: 'Current Weather: New York, NY. Sunny, 12°C, wind 8 km/h.',
      duration: 12,
      timestamp: '2026-11-21T09:39:54.000Z'
    },
    {
      name: 'get_current_weather',
      arguments: { location: 'San Francisco' },
      result: 'Current Weather: San Francisco, CA. Coastal clouds, 17°C, wind 15 km/h.',
      duration: 10,
      timestamp: '2026-11-21T09:39:54.012Z'
    }
  ],
  5100,
  claudeHaikuAgent
);
const suiteScenarioResults = [londonResult, parisResult, comparisonResult];
const suiteCheckCounts = suiteScenarioResults.reduce(
  (total, result) => ({
    passed: total.passed + result.checkCounts.passed,
    failed: total.failed + result.checkCounts.failed,
    not_evaluated: total.not_evaluated + result.checkCounts.not_evaluated,
    total: total.total + result.checkCounts.total
  }),
  { passed: 0, failed: 0, not_evaluated: 0, total: 0 }
);
const suiteTotalRuns = suiteScenarioResults.reduce((total, result) => total + result.totalRuns, 0);
const suiteResult: EvalResult = {
  ...demoResult,
  id: 'weather-suite-run-001',
  configId: demoConfigSuite.id,
  configHash: 'weather-suite-fixture-hash',
  configPath: demoConfigSuite.sourcePath,
  configName: demoConfigSuite.name,
  timestamp: '2026-11-22T10:30:00.000Z',
  scenarios: suiteScenarioResults.flatMap((result) => result.scenarios),
  overallPassRate: 1,
  totalScenarios: demoConfigSuite.scenarios.length,
  totalRuns: suiteTotalRuns,
  avgToolCalls:
    suiteScenarioResults.reduce((total, result) => total + result.avgToolCalls, 0) / suiteTotalRuns,
  avgLatency:
    suiteScenarioResults.reduce((total, result) => total + result.avgLatency, 0) / suiteTotalRuns,
  totalDurationMs: suiteScenarioResults.reduce((total, result) => total + result.totalDurationMs, 0),
  totalToolDurationMs: suiteScenarioResults.reduce(
    (total, result) => total + result.totalToolDurationMs,
    0
  ),
  outcomes: { passed: suiteTotalRuns },
  evaluationRunId: 'weather-suite-evaluation-001',
  checkCounts: suiteCheckCounts
};
const dashboardRunTimestamps = [
  '2026-11-23T07:53:55.494Z',
  '2026-11-22T10:30:00.000Z',
  '2026-11-21T09:40:00.000Z',
  '2026-11-20T14:25:00.000Z',
  '2026-11-19T11:10:00.000Z',
  '2026-11-18T08:35:00.000Z',
  '2026-11-17T16:05:00.000Z',
  '2026-11-16T13:20:00.000Z',
  '2026-11-15T10:45:00.000Z',
  '2026-11-14T09:05:00.000Z'
];
const dashboardResults: EvalResult[] = dashboardRunTimestamps.map((timestamp, index) => {
  const template = index === 0 ? demoResult : index % 2 === 1 ? suiteResult : demoResult;
  const resultId = index === 0 ? runId : `weather-mcp-demo-${String(index + 1).padStart(2, '0')}`;
  return {
    ...template,
    id: resultId,
    evaluationRunId: resultId,
    timestamp,
    scenarios: template.scenarios.map((scenario) => ({
      ...scenario,
      runs: scenario.runs.map((run, runIndex) => ({
        ...run,
        requestId: `${resultId}:${scenario.scenarioId}:${scenario.agentId}:run${runIndex + 1}`
      }))
    }))
  };
});

export const demoSummary: WorkspaceRunSummary = {
  runId,
  evaluationRunId: runId,
  path: '/workspace/mcplab/results/evaluation-runs/' + runId + '/results.json',
  timestamp: date,
  configHash: demoResult.configHash,
  configPath: demoConfig.sourcePath,
  configName: demoConfig.name,
  mcpServerVersions: demoResult.mcpServerVersions,
  scenarioIds: [demoScenario.id],
  scenarioNames: [demoScenario.name],
  agentIds: [demoAgent.id],
  totalScenarios: 1,
  totalRuns: 1,
  passRate: 1,
  avgToolCalls: 2,
  avgLatencyMs: 9.5,
  totalDurationMs: 6898,
  totalToolDurationMs: 19,
  outcomes: { passed: 1 },
  executionSource: 'mcplab',
  checkCounts: { passed: 10, failed: 0, not_evaluated: 0, total: 10 }
};

const relatedSummary = (result: EvalResult): WorkspaceRunSummary => ({
  runId: result.id,
  evaluationRunId: result.evaluationRunId,
  path: '/workspace/mcplab/results/evaluation-runs/' + result.id + '/results.json',
  timestamp: result.timestamp,
  configHash: result.configHash,
  configPath: result.configPath,
  configName: result.configName,
  mcpServerVersions: result.mcpServerVersions,
  scenarioIds: result.scenarios.map((scenario) => scenario.scenarioId),
  scenarioNames: result.scenarios.map((scenario) => scenario.scenarioName),
  agentIds: result.scenarios.map((scenario) => scenario.agentId),
  totalScenarios: result.totalScenarios,
  totalRuns: result.totalRuns,
  passRate: result.overallPassRate,
  avgToolCalls: result.avgToolCalls,
  avgLatencyMs: result.avgLatency,
  totalDurationMs: result.totalDurationMs,
  totalToolDurationMs: result.totalToolDurationMs,
  outcomes: result.outcomes,
  executionSource: result.executionSource,
  checkCounts: result.checkCounts
});

export const demoConfigs = [demoConfig, demoConfigSuite];
export const demoScenarios = [demoScenario, ...relatedScenarios];
export const demoResults = [demoResult, suiteResult, londonResult, comparisonResult, parisResult];
export const demoSummaries = [demoSummary, ...demoResults.slice(1).map(relatedSummary)];
export const dashboardSummaries: WorkspaceRunSummary[] = dashboardResults.map(relatedSummary);

const runningQueueEntry = {
  jobId: 'job-weather-active-001',
  evaluationRunId: 'weather-evaluation-active-001',
  evaluationName: demoConfigSuite.name,
  executionType: 'mcplab' as const,
  status: 'running' as const,
  runParams: {
    executionType: 'mcplab' as const,
    evaluationRunId: 'weather-evaluation-active-001',
    evaluationName: demoConfigSuite.name,
    configPath: demoConfigSuite.sourcePath ?? 'weather-mcp-eval-1.yaml',
    runsPerScenario: 1,
    scenarioIds: relatedScenarios.map((scenario) => scenario.id),
    agents: [claudeHaikuAgent.id],
    runNote: null,
    serverOverrideAll: null,
    scenarioServerOverrides: null
  },
  childProgress: [
    {
      scenarioId: 'current-weather-london',
      agentName: claudeHaikuAgent.name,
      serverNames: ['Weather MCP'],
      completed: 1,
      total: 1,
      status: 'completed' as const
    },
    {
      scenarioId: 'weather-paris',
      agentName: claudeHaikuAgent.name,
      serverNames: ['Weather MCP'],
      completed: 0,
      total: 1,
      status: 'running' as const,
      currentRunIndex: 0
    },
    {
      scenarioId: 'compare-weather',
      agentName: claudeHaikuAgent.name,
      serverNames: ['Weather MCP'],
      completed: 0,
      total: 1,
      status: 'queued' as const
    }
  ]
};

const runningQueue: QueueResponse = {
  active: runningQueueEntry,
  active_jobs: [runningQueueEntry],
  admitting_jobs: [],
  queued: [],
  evaluations: [
    {
      evaluationRunId: 'weather-evaluation-active-001',
      evaluationName: demoConfigSuite.name,
      status: 'running',
      totalJobs: 3,
      completedJobs: 1,
      failedJobs: 0,
      stoppedJobs: 0,
      pausedJobs: 0,
      jobs: [runningQueueEntry]
    }
  ]
};

export const sourceFor = (
  populated: boolean,
  hasRunningQueue = false,
  isDashboard = false
): EvalDataSource =>
  new Proxy({} as EvalDataSource, {
    get: (_target, property) => {
      if (property === 'subscribeRunQueue')
        return (onEvent: (event: RunQueueSseEvent) => void) => {
          onEvent({ type: 'connected', ts: date, payload: { message: 'Storybook fixture' } });
          return () => {};
        };
      if (String(property).startsWith('subscribe'))
        return () => () => {};
      if (property === 'getRunQueue')
        return async () => hasRunningQueue ? runningQueue : ({
          active: null,
          active_jobs: [],
          admitting_jobs: [],
          queued: [],
          evaluations: []
        });
      if (property === 'listResults')
        return async () => (populated ? (isDashboard ? dashboardResults : demoResults) : []);
      if (property === 'listRunSummaries')
        return async (filter?: { since?: string; until?: string }) =>
          populated
            ? (isDashboard ? dashboardSummaries : demoSummaries).filter(
                (summary) =>
                  (!filter?.since || summary.timestamp >= filter.since) &&
                  (!filter?.until || summary.timestamp <= filter.until)
              )
            : [];
      if (property === 'listRunSummariesPage')
        return async () => ({
          object: 'list',
          url: '',
          data: populated ? demoSummaries : [],
          has_more: false,
          total_count: populated ? demoSummaries.length : 0,
          next_offset: null,
          prev_offset: null
        });
      if (property === 'getResult')
        return async (id: string) =>
          populated
            ? (isDashboard ? dashboardResults : demoResults).find((result) => result.id === id)
            : undefined;
      if (property === 'getLatestPassRatesByConfigIds')
        return async () =>
          populated ? { [demoConfig.id]: 1, [demoConfigSuite.id]: 1 } : {};
      if (property === 'health') return async () => ({ ok: true, version: demoVersion, mcp: {} });
      if (String(property).startsWith('list')) return async () => [];
      if (String(property).startsWith('get')) return async () => undefined;
      if (String(property).startsWith('start')) return async () => ({ jobId: 'storybook-job' });
      return async () => undefined;
    }
  });
