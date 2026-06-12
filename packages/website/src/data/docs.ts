export type DocNavItem = {
  label: string;
  href: string;
  description: string;
  keywords?: string[];
};

export type DocSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  codeBlocks?: {
    title?: string;
    language?: string;
    code: string;
  }[];
  screenshot?: string;
};

export type DocPage = DocNavItem & {
  slug: string;
  seoTitle: string;
  track: 'getting-started' | 'cli' | 'app' | 'reference';
  sections: DocSection[];
};

// ─── Getting Started ──────────────────────────────────────────────────────────

const overview: DocPage = {
  slug: 'overview',
  label: 'Overview',
  href: '/docs/',
  description: 'What MCPLab does and when to use it.',
  keywords: ['overview', 'start', 'guide', 'introduction'],
  seoTitle: 'Documentation',
  track: 'getting-started',
  sections: [
    {
      id: 'what-it-does',
      title: 'What MCPLab Does',
      paragraphs: [
        'MCPLab is a testing and evaluation framework for MCP servers. It lets you write scenarios that describe tasks an LLM agent should complete using your MCP tools, then run those scenarios against one or more models and assert on the results.',
        'You define which tools should be called, in what order, and what the response should contain. MCPLab runs the agent, captures the full tool call trace, and reports pass or fail for each assertion.'
      ],
      bullets: [
        'Validate that LLM agents use your MCP tools correctly.',
        'Compare multiple models on the same scenarios.',
        'Catch regressions with repeatable, automated runs.',
        'Inspect full tool call traces for debugging.'
      ]
    },
    {
      id: 'two-tracks',
      title: 'CLI and App — Two Equal Paths',
      paragraphs: [
        'MCPLab has two interfaces. The CLI is a terminal command you run directly or from CI. The App is a local web UI that wraps the same engine with visual reports, AI-assisted scenario design, and tool quality review.',
        'Both are installed from the same npm package. Choose based on how you work: use the CLI for scripted pipelines and quick terminal runs, use the App when you want interactive exploration and AI assistance.'
      ],
      bullets: [
        'CLI: mcplab run — terminal output, HTML reports, CI-ready exit codes.',
        'App: mcplab app — local web UI, run evaluations visually, AI assistants.'
      ]
    }
  ]
};

const installation: DocPage = {
  slug: 'installation',
  label: 'Installation',
  href: '/docs/installation/',
  description: 'Install MCPLab and configure your API keys.',
  keywords: ['install', 'npx', 'global', 'setup', 'api key'],
  seoTitle: 'Installation',
  track: 'getting-started',
  sections: [
    {
      id: 'install',
      title: 'Install',
      paragraphs: [
        'Use npx for the fastest path — no install step required.',
        'Install globally if you prefer a persistent command on your PATH.'
      ],
      codeBlocks: [
        { title: 'npx (no install)', language: 'bash', code: 'npx @inspectr/mcplab --help' },
        { title: 'global install', language: 'bash', code: 'npm install -g @inspectr/mcplab' }
      ]
    },
    {
      id: 'environment',
      title: 'Set Up Environment',
      paragraphs: [
        'MCPLab reads provider API keys from environment variables. Add the keys for the providers your evals will use.'
      ],
      codeBlocks: [
        {
          title: '.env',
          language: 'bash',
          code: `# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
OPENAI_API_KEY=sk-...

# Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o`
        }
      ]
    }
  ]
};

const quickStart: DocPage = {
  slug: 'quick-start',
  label: 'Quick Start',
  href: '/docs/quick-start/',
  description: 'Write your first eval and see results in under 5 minutes.',
  keywords: ['quick start', 'first eval', 'yaml', 'scenario', 'run'],
  seoTitle: 'Quick Start',
  track: 'getting-started',
  sections: [
    {
      id: 'create-config',
      title: 'Create an Eval Config',
      paragraphs: [
        'An eval config is a YAML file with three sections: servers (which MCP endpoints to test), agents (which LLMs to use), and scenarios (what tasks to run and what to assert).'
      ],
      codeBlocks: [
        {
          title: 'eval.yaml',
          language: 'yaml',
          code: `servers:
  - id: my-server
    transport: http
    url: http://localhost:3000/mcp

agents:
  - id: claude
    provider: anthropic
    model: claude-haiku-4-5-20251001
    temperature: 0

scenarios:
  - id: basic-test
    servers: [my-server]
    prompt: Use the tools to complete this task...
    eval:
      tool_constraints:
        required_tools: [my_tool]
      response_assertions:
        - type: regex
          pattern: success|completed`
        }
      ]
    },
    {
      id: 'run-it',
      title: 'Run It',
      paragraphs: [
        'Point MCPLab at your config and it will run all scenarios and generate a report.'
      ],
      codeBlocks: [
        { title: 'terminal', language: 'bash', code: 'npx @inspectr/mcplab run -c eval.yaml' }
      ]
    },
    {
      id: 'next-steps',
      title: 'Next Steps',
      paragraphs: [
        'Follow the CLI track to learn about all run options, configuration patterns, and CI integration. Follow the App track to run evaluations from a UI with AI assistants built in.'
      ]
    }
  ]
};

const setupEvaluations: DocPage = {
  slug: 'setting-up-evaluations',
  label: 'Setting Up Evaluations',
  href: '/docs/setting-up-evaluations/',
  description: 'Set up a robust evaluation workflow before running your first full test suite.',
  keywords: ['setup evaluations', 'eval config', 'libraries', 'mcp servers', 'auth', 'preflight'],
  seoTitle: 'Setting Up Evaluations',
  track: 'getting-started',
  sections: [
    {
      id: 'layout',
      title: 'Recommended Project Layout',
      paragraphs: [
        'Use a consistent workspace layout so CLI and App commands resolve configs, libraries, and results predictably.'
      ],
      codeBlocks: [
        {
          title: 'recommended layout',
          language: 'text',
          code: `mcplab/\n  evals/\n    eval.yaml\n  results/\n    evaluation-runs/\n  servers.yaml\n  agents.yaml`
        }
      ],
      bullets: [
        'Keep evaluation YAML files in `mcplab/evals`.',
        'Keep reusable servers and agents in library files.',
        'Store run output in `mcplab/results/evaluation-runs`.'
      ]
    },
    {
      id: 'author-config',
      title: 'Author a Minimal, Valid Config',
      paragraphs: [
        'Start with one agent and one scenario. Validate this baseline first before adding more scenarios or models.'
      ],
      codeBlocks: [
        {
          title: 'mcplab/evals/eval.yaml',
          language: 'yaml',
          code: `agents:\n  - id: claude-haiku\n    provider: anthropic\n    model: claude-haiku-4-5-20251001\n    temperature: 0\n\nscenarios:\n  - id: setup-check\n    agent: claude-haiku\n    servers: [demo-server]\n    mcp_servers:\n      - id: demo-server\n        transport: http\n        url: http://localhost:3000/mcp\n    prompt: Use available tools to complete this setup verification task.`
        }
      ]
    },
    {
      id: 'auth-env',
      title: 'Configure Auth and Environment',
      paragraphs: [
        'Set provider keys and server auth variables before running evaluations. Keep secret values in environment variables, not in committed YAML.'
      ],
      codeBlocks: [
        {
          title: '.env example',
          language: 'bash',
          code: `ANTHROPIC_API_KEY=...\nOPENAI_API_KEY=...\nMY_SERVER_TOKEN=...`
        }
      ],
      bullets: [
        'Use `auth.type: bearer` + `env` for bearer-token server auth.',
        'Use `auth.type: oauth_client_credentials` for client-credentials flows.',
        'Use `auth.type: oauth_authorization_code` when interactive/browser OAuth is required.'
      ]
    },
    {
      id: 'preflight',
      title: 'Preflight Checklist',
      bullets: [
        'MCP endpoint URL is reachable and returns MCP responses.',
        'Scenario IDs are unique and agent references resolve.',
        'Server labels in `scenarios[].servers` match your intended MCP server entries.',
        'All required env var names are set in your shell/session.',
        'You can run one scenario once successfully before scaling.'
      ],
      codeBlocks: [
        {
          title: 'first validation run',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c mcplab/evals/eval.yaml -s setup-check -n 1'
        }
      ]
    },
    {
      id: 'next',
      title: 'Next Setup Steps',
      bullets: [
        'Add more scenarios after the baseline setup-check passes.',
        'Use `--agents` to compare models on the same scenarios.',
        'Open `report.html` or the App results view to inspect failures and tool traces.'
      ]
    }
  ]
};

const scenarioConfiguration: DocPage = {
  slug: 'scenario-configuration',
  label: 'Scenario Configuration',
  href: '/docs/scenario-configuration/',
  description: 'Detailed guide for writing MCPLab scenarios and assertions.',
  keywords: [
    'scenario configuration',
    'scenarios',
    'mcp_servers',
    'tool constraints',
    'response assertions',
    'extract'
  ],
  seoTitle: 'Scenario Configuration',
  track: 'getting-started',
  sections: [
    {
      id: 'scenario-fields',
      title: 'Scenario Fields',
      paragraphs: [
        'A scenario defines one test case the agent must execute against available MCP servers.'
      ],
      bullets: [
        '`id` — unique scenario identifier. Use kebab-case.',
        '`prompt` — exact task instruction given to the agent.',
        '`agent` — optional pinned agent id. Omit to run all selected agents.',
        '`servers` — labels available in the scenario context.',
        '`mcp_servers` — concrete MCP server definitions (`ref` or inline server config).',
        '`eval` — assertions on tool usage, sequence, and response output.',
        '`extract` — capture values from final text using regex named group `value`.'
      ]
    },
    {
      id: 'minimal-example',
      title: 'Minimal Scenario Example',
      codeBlocks: [
        {
          title: 'single scenario baseline',
          language: 'yaml',
          code: `scenarios:
  - id: weather-baseline
    agent: claude-haiku
    servers: [weather-api]
    mcp_servers:
      - id: weather-api
        transport: http
        url: http://localhost:3000/mcp
    prompt: Get today's forecast for Brussels and summarize in one sentence.`
        }
      ]
    },
    {
      id: 'tool-assertions',
      title: 'Tool and Response Assertions',
      paragraphs: [
        'Add `eval` only after the baseline prompt run works, then tighten expectations incrementally.',
        'For a full assertion catalog with examples for every type, see Reference / Tool and Response Assertions.'
      ],
      codeBlocks: [
        {
          title: 'scenario with assertions',
          language: 'yaml',
          code: `scenarios:
  - id: weather-asserted
    servers: [weather-api]
    mcp_servers:
      - ref: weather-api
    prompt: Return JSON with city and temperature_c for Brussels.
    eval:
      tool_constraints:
        required_tools: [get_weather]
        forbidden_tools: [delete_city]
      tool_sequence:
        allow:
          - [get_weather]
      response_assertions:
        - type: regex
          pattern: '([0-9]+)(\\.[0-9]+)?\\s?°?C'
        - type: jsonpath
          path: $.city
          equals: Brussels`
        }
      ],
      bullets: [
        'Use `required_tools` to enforce critical tool calls.',
        'Use `forbidden_tools` to block unsafe or irrelevant tools.',
        'Use literal response assertions (`contains`, `equals`, etc.) for stable text checks.',
        'Use regex assertions for variable outputs (numbers, IDs, timestamps).',
        'Use JSONPath assertions when the response is structured JSON.'
      ]
    },
    {
      id: 'extract-values',
      title: 'Extract Structured Values',
      paragraphs: [
        'Use `extract` when you want reusable values from the final response for downstream checks or reporting.'
      ],
      codeBlocks: [
        {
          title: 'extract with named capture group',
          language: 'yaml',
          code: `scenarios:
  - id: extract-temperature
    servers: [weather-api]
    prompt: Report the current temperature in Brussels in Celsius.
    extract:
      - name: brussels_temp_c
        from: final_text
        regex: 'Temperature:\\s*(?<value>[0-9]+(\\.[0-9]+)?)\\s*°?C'`
        }
      ]
    },
    {
      id: 'common-patterns',
      title: 'Common Configuration Patterns',
      bullets: [
        'Start with one scenario and one run (`-n 1`) until stable.',
        'Keep prompts deterministic; avoid broad, open-ended tasks first.',
        'Prefer `mcp_servers` refs for shared servers across many scenarios.',
        'Add one assertion at a time so failures are easy to diagnose.',
        'Split large workflows into multiple scenarios instead of one giant prompt.'
      ]
    },
    {
      id: 'validation-checklist',
      title: 'Scenario Validation Checklist',
      bullets: [
        'Scenario id is unique and readable.',
        '`servers` labels and `mcp_servers` mapping are coherent.',
        'Pinned `agent` exists in your agents list/library.',
        'Assertions test behavior, not cosmetic phrasing only.',
        'A focused command can run this scenario in isolation.'
      ],
      codeBlocks: [
        {
          title: 'run one scenario',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c mcplab/evals/eval.yaml -s weather-asserted -n 1'
        }
      ]
    }
  ]
};

const librariesAndRefs: DocPage = {
  slug: 'libraries-and-refs',
  label: 'Libraries & Refs',
  href: '/docs/libraries-and-refs/',
  description: 'Reuse shared servers, agents, and scenarios across evaluation configs.',
  keywords: ['libraries', 'refs', 'servers.yaml', 'agents.yaml', 'scenarios', 'reuse'],
  seoTitle: 'Libraries & Refs',
  track: 'getting-started',
  sections: [
    {
      id: 'what-it-is',
      title: 'What the Library System Is',
      paragraphs: [
        'MCPLab libraries let you define shared servers, agents, and scenarios once, then reference them from many eval configs.',
        'This reduces duplication and keeps team-wide defaults consistent.'
      ]
    },
    {
      id: 'structure',
      title: 'Recommended Library Structure',
      codeBlocks: [
        {
          title: 'library layout',
          language: 'text',
          code: `mcplab/\n├── servers.yaml\n├── agents.yaml\n└── scenarios/\n    ├── scenario-a.yaml\n    └── scenario-b.yaml`
        }
      ],
      bullets: [
        '`servers.yaml` contains reusable MCP server definitions.',
        '`agents.yaml` contains reusable LLM agent definitions.',
        '`scenarios/` contains reusable scenario files.'
      ]
    },
    {
      id: 'suite-labels',
      title: 'Suite Labels from Folder Paths',
      paragraphs: [
        'Eval configs placed in subfolders automatically derive a suite label from their folder path. The App groups and displays configs by suite in the Configurations page, making it easy to run or browse related configs together.',
        'The suite label is the relative folder path from the evals root. A file at `evals/search/basic.yaml` gets the suite label "search".'
      ],
      codeBlocks: [
        {
          title: 'folder structure → suite labels',
          language: 'text',
          code: `evals/\n├── search/\n│   ├── basic.yaml       → suite: "search"\n│   └── advanced.yaml    → suite: "search"\n└── auth/\n    └── login.yaml       → suite: "auth"`
        }
      ]
    },
    {
      id: 'use-refs',
      title: 'Reference Library Items in eval.yaml',
      paragraphs: [
        'Use `ref` entries to pull shared items into an eval config by id.',
        'For referenced scenarios, you can override MCP targets with `mcp_servers` while keeping prompt/eval logic in the test-case.'
      ],
      codeBlocks: [
        {
          title: 'eval.yaml using refs',
          language: 'yaml',
          code: `agents:\n  - ref: claude-sonnet\n\nscenarios:\n  - ref: add-calculations\n    mcp_servers:\n      - ref: kpi-api-stage`
        }
      ]
    },
    {
      id: 'resolution',
      title: 'How Ref Resolution Works',
      bullets: [
        'Server refs resolve from `servers.yaml`.',
        'Agent refs resolve from `agents.yaml`.',
        'Scenario refs resolve from files in `test-cases/`.',
        'When a referenced scenario includes `mcp_servers` overlay, that overlay is used for runtime MCP binding.',
        'Missing refs are reported and should be fixed before running.'
      ]
    },
    {
      id: 'app-cli',
      title: 'Use Libraries in App and CLI',
      bullets: [
        'App: start with `--libraries-dir` so shared library content is loaded.',
        'CLI run: refs resolve when library files are present in the configured layout.',
        'App UI: inspect and manage shared items in the Library section.'
      ],
      codeBlocks: [
        {
          title: 'start app with libraries',
          language: 'bash',
          code: 'npx @inspectr/mcplab app --libraries-dir ./mcplab'
        }
      ]
    }
  ]
};

// ─── CLI Track ────────────────────────────────────────────────────────────────

const cliRunning: DocPage = {
  slug: 'cli-running-evaluations',
  label: 'Running Evaluations',
  href: '/docs/cli/running-evaluations/',
  description: 'The mcplab run command and all its options.',
  keywords: ['run', 'cli', 'scenarios', 'agents', 'variance', 'interactive'],
  seoTitle: 'CLI — Running Evaluations',
  track: 'cli',
  sections: [
    {
      id: 'basic-run',
      title: 'Basic Run',
      paragraphs: ['Point mcplab at your eval config to run all scenarios.'],
      codeBlocks: [
        {
          title: 'run all scenarios',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml'
        }
      ]
    },
    {
      id: 'filter-scenarios',
      title: 'Filter Scenarios',
      paragraphs: [
        'Run a single scenario by its ID using -s. Pass the flag multiple times to run several.'
      ],
      codeBlocks: [
        {
          title: 'single scenario',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml -s basic-test'
        },
        {
          title: 'multiple scenarios',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml -s test-one -s test-two'
        }
      ]
    },
    {
      id: 'select-agents',
      title: 'Select Agents',
      paragraphs: [
        'By default all agents defined in the config are used. Narrow the selection with --agents or expand to include agents from the config and library with --agents-all.'
      ],
      codeBlocks: [
        {
          title: 'specific agents',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml --agents claude,gpt4o'
        },
        {
          title: 'all agents (config + library)',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml --agents-all'
        }
      ]
    },
    {
      id: 'runtime-server-overrides',
      title: 'Runtime Server Overrides',
      paragraphs: [
        'Switch MCP targets at run-time without editing eval YAML. Use --server-override-all for a fast environment switch (dev/stage/prod), then refine specific tests with --server-override.',
        'Precedence is: config defaults < --server-override-all < --server-override <scenarioId=...>. Overrides are ephemeral and apply only to the current run.'
      ],
      codeBlocks: [
        {
          title: 'switch all selected tests to staging',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml --server-override-all kpi-api-stage'
        },
        {
          title: 'global switch plus one per-test exception',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml --server-override-all kpi-api-stage --server-override add-calculations=kpi-api-dev'
        }
      ]
    },
    {
      id: 'variance-runs',
      title: 'Variance Runs',
      paragraphs: [
        'Run each scenario multiple times to measure consistency. The -n flag sets the number of runs per scenario. Results include a pass rate across all runs.'
      ],
      codeBlocks: [
        {
          title: '5 runs per scenario',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml -n 5'
        }
      ]
    },
    {
      id: 'interactive-mode',
      title: 'Interactive Mode',
      paragraphs: [
        'Interactive mode prompts you to pick a config and scenarios at the terminal instead of specifying them as flags. Useful for ad-hoc runs during development.'
      ],
      codeBlocks: [
        {
          title: 'interactive',
          language: 'bash',
          code: 'npx @inspectr/mcplab run --interactive'
        }
      ]
    },
    {
      id: 'annotate-runs',
      title: 'Annotate and Organise Runs',
      paragraphs: [
        'Add a human-readable note to a run for easier identification in reports and the App. Change the output directory with --runs-dir.'
      ],
      codeBlocks: [
        {
          title: 'annotated run',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml --run-note "after refactor"'
        },
        {
          title: 'custom output dir',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml --runs-dir ./my-runs'
        }
      ]
    },
    {
      id: 'batch-runs',
      title: 'Batch Runs — Directory Mode',
      paragraphs: [
        'Pass a directory path to -c/--config and MCPLab will discover and run all .yaml and .yml files in that directory recursively. This is useful for running an entire suite of eval configs in one command.',
        'Use --bail to stop the batch after the first config that has any failing scenario (fail-fast mode). Without --bail, all configs run regardless of individual failures.'
      ],
      codeBlocks: [
        {
          title: 'run all configs in a directory',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c ./evals/'
        },
        {
          title: 'stop on first failure',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c ./evals/ --bail'
        }
      ]
    },
    {
      id: 'exit-codes',
      title: 'Exit Codes',
      paragraphs: [
        'mcplab run exits 0 when all scenarios pass and non-zero when any scenario fails. Use this in CI to fail a pipeline on a regression.'
      ]
    }
  ]
};

const cliConfiguration: DocPage = {
  slug: 'cli-configuration',
  label: 'Configuration',
  href: '/docs/cli/configuration/',
  description: 'Write eval.yaml — servers, agents, scenarios, assertions, and auth.',
  keywords: [
    'config',
    'yaml',
    'servers',
    'agents',
    'scenarios',
    'assertions',
    'bearer token',
    'refs'
  ],
  seoTitle: 'CLI — Configuration',
  track: 'cli',
  sections: [
    {
      id: 'structure',
      title: 'Structure Overview',
      paragraphs: [
        'An eval file requires `agents` and `scenarios`.',
        'Top-level `servers` exists for backward compatibility but is deprecated. Prefer scenario-owned `mcp_servers`.'
      ],
      codeBlocks: [
        {
          title: 'eval.yaml skeleton',
          language: 'yaml',
          code: `agents:
  - id: claude
    provider: anthropic
    model: claude-haiku-4-5-20251001
    temperature: 0

scenarios:
  - id: basic-test
    mcp_servers:
      - id: my-server
        transport: http
        url: http://localhost:3000/mcp
    prompt: Describe what you want the agent to do.
    eval:
      tool_constraints:
        required_tools: [tool_name]`
        }
      ]
    },
    {
      id: 'servers',
      title: 'Servers',
      paragraphs: [
        'Each server entry needs an id, a transport (http for HTTP/SSE), and the URL of the MCP endpoint.',
        'If the endpoint requires a bearer token, add a token field. Use a literal string for a hardcoded value or a $ENV_VAR reference to read from the environment.'
      ],
      codeBlocks: [
        {
          title: 'server with bearer token',
          language: 'yaml',
          code: `servers:
  - id: my-server
    transport: http
    url: http://localhost:3000/mcp
    token: "my-static-token"          # literal value

  - id: prod-server
    transport: http
    url: https://api.example.com/mcp
    token: $SERVER_API_TOKEN           # reads from env`
        }
      ]
    },
    {
      id: 'agents',
      title: 'Agents',
      paragraphs: [
        'Each agent entry needs an id, a provider, and a model. Supported providers are anthropic, openai, and azure.',
        'temperature defaults to 0. Lower values produce more deterministic results which is generally better for eval consistency.'
      ],
      codeBlocks: [
        {
          title: 'agents',
          language: 'yaml',
          code: `agents:
  - id: claude
    provider: anthropic
    model: claude-haiku-4-5-20251001
    temperature: 0

  - id: gpt4o
    provider: openai
    model: gpt-4o
    temperature: 0

  - id: azure-gpt
    provider: azure
    model: gpt-4o
    temperature: 0`
        }
      ]
    },
    {
      id: 'scenarios',
      title: 'Scenarios',
      paragraphs: [
        'Inline scenarios define prompt/eval and may include `mcp_servers`.',
        'Referenced scenarios can override only MCP target with `mcp_servers` while keeping test-case prompt/eval.'
      ],
      codeBlocks: [
        {
          title: 'referenced scenario with mcp override',
          language: 'yaml',
          code: `scenarios:
  - ref: add-calculations
    mcp_servers:
      - ref: kpi-api-stage`
        }
      ]
    },
    {
      id: 'assertions',
      title: 'Assertions',
      paragraphs: ['Two types of assertions are available in the eval block.'],
      bullets: [
        'tool_constraints.required_tools — list of tool names the agent MUST call.',
        'tool_constraints.forbidden_tools — list of tool names the agent MUST NOT call.',
        'response_assertions type: regex — the agent response must match the regular expression in pattern.',
        'response_assertions type: jsonpath — evaluate JSON output at path and optionally match equals.'
      ]
    },
    {
      id: 'refs',
      title: 'Reusable Refs',
      paragraphs: [
        'Use `ref` to reference library items from `agents.yaml`, `servers.yaml`, and `test-cases/`.'
      ],
      codeBlocks: [
        {
          title: 'library refs in eval',
          language: 'yaml',
          code: `agents:
  - ref: claude-sonnet-46

scenarios:
  - ref: add-calculations
    mcp_servers:
      - ref: kpi-api-prod`
        }
      ]
    },
    {
      id: 'library-files',
      title: 'Library Files',
      paragraphs: [
        'A library is a directory of shared agents.yaml and servers.yaml files loaded by mcplab at startup. Library items are available to all eval configs without explicit $ref — you reference them by id.',
        'Pass --libraries-dir when starting mcplab app to point it at a library directory. See the App / Library docs for managing library content through the UI.'
      ],
      codeBlocks: [
        {
          title: 'agents.yaml (library file)',
          language: 'yaml',
          code: `agents:
  - id: claude-haiku
    provider: anthropic
    model: claude-haiku-4-5-20251001
    temperature: 0

  - id: gpt4o-mini
    provider: openai
    model: gpt-4o-mini
    temperature: 0`
        },
        {
          title: 'using a library agent in eval.yaml',
          language: 'yaml',
          code: `# No agents block needed — claude-haiku comes from the library
scenarios:
  - id: basic-test
    agent: claude-haiku
    servers: [my-server]
    prompt: Complete the task.`
        }
      ]
    }
  ]
};

const cliReports: DocPage = {
  slug: 'cli-reports-output',
  label: 'Reports & Output',
  href: '/docs/cli/reports-output/',
  description: 'What MCPLab writes after a run and how to work with it.',
  keywords: [
    'reports',
    'output',
    'results',
    'trace',
    'html',
    'json',
    'mcplab report',
    'mcplab results'
  ],
  seoTitle: 'CLI — Reports & Output',
  track: 'cli',
  sections: [
    {
      id: 'run-directory',
      title: 'Run Directory',
      paragraphs: [
        'Every mcplab run creates a timestamped directory under mcplab/results/evaluation-runs (or --runs-dir if set). The directory contains four files.'
      ],
      bullets: [
        'results.json — structured pass/fail for every scenario, assertion, and tool call.',
        'trace.jsonl — full tool call trace in newline-delimited JSON. One line per LLM exchange.',
        'report.html — self-contained interactive HTML report. Open it in a browser.',
        'summary.md — short markdown summary suitable for commit comments or Slack.'
      ]
    },
    {
      id: 'results-json',
      title: 'results.json',
      paragraphs: [
        'The results file records every scenario run: which agent was used, which tools were called, whether each assertion passed, and the final response. It is the source of truth for all downstream reports.'
      ]
    },
    {
      id: 'trace-jsonl',
      title: 'trace.jsonl',
      paragraphs: [
        'The trace captures the full sequence of LLM messages and tool calls for every scenario run. Each line is a JSON object representing one exchange. Use the trace to understand exactly what the agent did and why.'
      ]
    },
    {
      id: 'results-query-workflow',
      title: 'LLM-First Results Query Workflow',
      paragraphs: [
        'Use mcplab results commands when you need compact, structured output that is easy for LLMs and automation to consume.',
        'mcplab results search auto-builds or refreshes local index when run artifacts changed. You can also prebuild manually with mcplab results index.'
      ],
      codeBlocks: [
        {
          title: 'list and inspect runs',
          language: 'bash',
          code: `npx @inspectr/mcplab results list\nnpx @inspectr/mcplab results show --run <run-id> --format json`
        },
        {
          title: 'search and fetch focused context',
          language: 'bash',
          code: `npx @inspectr/mcplab results search "tool failed timeout" --status failed --format json\nnpx @inspectr/mcplab results context --run <run-id> --scenario <scenario-id> --source trace --around 42 --format markdown`
        }
      ]
    },
    {
      id: 'regenerate-report',
      title: 'Regenerating a Report',
      paragraphs: [
        'The mcplab report command regenerates report.html from an existing run directory. Use this if you update the report template or if you want to re-render a report from a CI artifact.'
      ],
      codeBlocks: [
        {
          title: 'from a specific run directory',
          language: 'bash',
          code: 'npx @inspectr/mcplab report --input ./runs/2026-03-01T12-00-00'
        },
        {
          title: 'interactive — pick a run from a list',
          language: 'bash',
          code: 'npx @inspectr/mcplab report --interactive'
        }
      ]
    }
  ]
};

const cliResultsQuery: DocPage = {
  slug: 'cli-results-query',
  label: 'Results Query',
  href: '/docs/cli/results-query/',
  description: 'LLM-first querying of run artifacts with mcplab results.',
  keywords: ['results query', 'mcplab results', 'search', 'context', 'index', 'jsonl'],
  seoTitle: 'CLI — Results Query',
  track: 'cli',
  sections: [
    {
      id: 'overview',
      title: 'What This Command Does',
      paragraphs: [
        'mcplab results provides machine-first access to evaluation run artifacts. Use it to find failures quickly with compact structured output, then fetch only focused context.',
        'This is the recommended workflow for LLM and automation analysis over large result sets.'
      ]
    },
    {
      id: 'workflow',
      title: 'Recommended Workflow',
      bullets: [
        'List runs to identify target run IDs.',
        'Search broadly with compact JSON output.',
        'Fetch focused scenario context only for top hit(s).',
        'Avoid loading full trace.jsonl unless needed.'
      ],
      codeBlocks: [
        {
          title: 'broad search then focused context',
          language: 'bash',
          code: `npx @inspectr/mcplab results search "tool failed timeout" --status failed --limit 10 --format json\nnpx @inspectr/mcplab results context --run <run-id> --scenario <scenario-id> --source trace --around 42 --format markdown`
        }
      ]
    },
    {
      id: 'subcommands',
      title: 'Subcommands',
      bullets: [
        'mcplab results list — list available runs.',
        'mcplab results show --run <runId> — show run as json or summary markdown.',
        'mcplab results index [--rebuild] — manual index build/refresh.',
        'mcplab results search <query> — search indexed results/trace/summary.',
        'mcplab results context --run <runId> --scenario <id> — fetch focused excerpt.'
      ]
    },
    {
      id: 'search-options',
      title: 'Search Options and Defaults',
      paragraphs: ['Defaults are tuned for LLM use: compact and structured.'],
      bullets: [
        '--runs-dir: mcplab/results/evaluation-runs',
        '--status: all',
        '--source: results,trace,summary',
        '--limit: 10',
        '--format: json'
      ],
      codeBlocks: [
        {
          title: 'filtered search',
          language: 'bash',
          code: 'npx @inspectr/mcplab results search "timeout" --status failed --agent claude-haiku --scenario search-tags --source trace --limit 5 --format json'
        }
      ]
    },
    {
      id: 'auto-index',
      title: 'Automatic Index Refresh',
      paragraphs: [
        'mcplab results search auto-refreshes local index when run files changed since last index build.',
        'You can still prebuild or force rebuild for CI or batch workflows.'
      ],
      codeBlocks: [
        {
          title: 'manual rebuild',
          language: 'bash',
          code: 'npx @inspectr/mcplab results index --rebuild'
        }
      ],
      bullets: [
        'Index file: mcplab/results/.index/results-search.jsonl',
        'Manifest file: mcplab/results/.index/manifest.json'
      ]
    }
  ]
};

const cliCicd: DocPage = {
  slug: 'cli-ci-cd',
  label: 'CI/CD',
  href: '/docs/cli/ci-cd/',
  description: 'Run MCPLab in GitHub Actions and other CI pipelines.',
  keywords: ['ci', 'cd', 'github actions', 'pipeline', 'automation', 'exit code'],
  seoTitle: 'CLI — CI/CD',
  track: 'cli',
  sections: [
    {
      id: 'github-actions',
      title: 'GitHub Actions',
      paragraphs: [
        'The example below runs evaluations on every push. It uploads the run directory as an artifact so you can inspect reports from the Actions UI.'
      ],
      codeBlocks: [
        {
          title: '.github/workflows/eval.yml',
          language: 'yaml',
          code: `name: MCPLab Evaluation

on: [push, pull_request]

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run evaluations
        run: npx @inspectr/mcplab run -c eval.yaml --run-note "ci-\${{ github.sha }}"
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}

      - name: Upload run artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mcplab-run
          path: runs/`
        }
      ]
    },
    {
      id: 'exit-codes',
      title: 'Exit Codes and Failure Detection',
      paragraphs: [
        'mcplab run exits 0 when all scenarios pass. Any failing scenario produces a non-zero exit code, which causes the CI step to fail.',
        'Use if: always() on the artifact upload step so reports are preserved even when the eval step fails.'
      ]
    },
    {
      id: 'env-vars-ci',
      title: 'Environment Variables in CI',
      paragraphs: [
        'Store API keys as repository secrets and pass them as environment variables. For server bearer tokens defined with $TOKEN_VAR in your config, add the matching secret.'
      ],
      codeBlocks: [
        {
          title: 'env block in workflow step',
          language: 'yaml',
          code: `env:
  ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
  OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
  SERVER_API_TOKEN: \${{ secrets.SERVER_API_TOKEN }}`
        }
      ]
    }
  ]
};

const cliCommandReference: DocPage = {
  slug: 'cli-command-reference',
  label: 'Command Reference',
  href: '/docs/cli/command-reference/',
  description: 'All mcplab commands and their flags in one place.',
  keywords: ['cli', 'commands', 'flags', 'options', 'reference', 'run', 'app', 'report', 'results'],
  seoTitle: 'CLI — Command Reference',
  track: 'cli',
  sections: [
    {
      id: 'run',
      title: 'mcplab run',
      paragraphs: ['Run evaluation scenarios against one or more eval configs.'],
      codeBlocks: [
        {
          title: 'usage',
          language: 'bash',
          code: 'npx @inspectr/mcplab run [options]'
        }
      ],
      bullets: [
        '-c, --config <path> — Path to eval.yaml or a directory of eval configs. Required (or use --interactive).',
        '-s, --scenario <id> — Run a single scenario by ID. Repeatable to run several.',
        '-n, --runs <count> — Number of variance runs per scenario. Default: 1.',
        '--agents <agents> — Comma-separated list of agent IDs to test.',
        '--agents-all — Run all agents configured in the eval config plus any loaded from the library.',
        '--interactive — Prompt for config path and agents at the terminal.',
        '--bail — Stop after the first failed config when --config points to a directory.',
        '--run-note <text> — Human-readable note attached to run metadata. Max 500 chars.',
        '--runs-dir <path> — Output directory for run artifacts. Default: mcplab/results/evaluation-runs.',
        '--oauth-token <server=token> — Pre-obtained OAuth bearer token for a named server. Repeatable.',
        '--server-override-all <serverRef[,serverRef...]> — Override MCP server refs for all selected scenarios (runtime only).',
        '--server-override <scenarioId=serverRef[,serverRef...]> — Override MCP server refs for one scenario. Repeatable. Higher priority than --server-override-all.',
        '--open-browser — Open browser to the MCPLab UI when OAuth authentication is required.'
      ]
    },
    {
      id: 'results',
      title: 'mcplab results',
      paragraphs: ['Query evaluation run artifacts with LLM-first structured outputs.'],
      codeBlocks: [
        {
          title: 'usage',
          language: 'bash',
          code: 'npx @inspectr/mcplab results <subcommand> [options]'
        }
      ],
      bullets: [
        'list — List run directories and basic run metadata.',
        'show --run <runId> — Show a run in json or markdown.',
        'index [--rebuild] — Build/refresh local results index under mcplab/results/.index.',
        'search <query> — Search indexed results/trace/summary and return compact hits.',
        'context --run <runId> --scenario <id> — Fetch focused excerpt, optionally with --around for trace line windows.',
        'search defaults: --status all, --source results,trace,summary, --limit 10, --format json.'
      ]
    },
    {
      id: 'report',
      title: 'mcplab report',
      paragraphs: ['Regenerate report.html from an existing run directory.'],
      codeBlocks: [
        {
          title: 'usage',
          language: 'bash',
          code: 'npx @inspectr/mcplab report [options]'
        }
      ],
      bullets: [
        '--input <runDir> — Path to the run directory containing results.json. Required unless --interactive.',
        '--runs-dir <path> — Directory containing run artifacts. Default: mcplab/results/evaluation-runs.',
        '--interactive — Pick a run directory from an interactive list.'
      ]
    },
    {
      id: 'app',
      title: 'mcplab app',
      paragraphs: ['Start the local web UI and API bridge.'],
      codeBlocks: [
        {
          title: 'usage',
          language: 'bash',
          code: 'npx @inspectr/mcplab app [options]'
        }
      ],
      bullets: [
        '--evals-dir <path> — Directory for eval YAML files. Default: mcplab/evals.',
        '--runs-dir <path> — Directory for run artifacts. Default: mcplab/results/evaluation-runs.',
        '--tool-analysis-results-dir <path> — Directory for tool analysis reports. Default: mcplab/results/tool-analysis.',
        '--libraries-dir <path> — Bundle root for shared servers, agents, and test cases. Default: mcplab.',
        '--port <number> — Port to bind the server to. Default: 8787.',
        '--host <host> — Host to bind. Default: 127.0.0.1.',
        '--open — Open the browser automatically after startup.',
        '--dev — Proxy frontend requests to a Vite dev server. API remains local.',
        '--interactive — Prompt for host, port, and directory paths before startup.'
      ]
    }
  ]
};

// ─── App Track ────────────────────────────────────────────────────────────────

const appGettingStarted: DocPage = {
  slug: 'app-getting-started',
  label: 'Starting the App',
  href: '/docs/app/getting-started/',
  description: 'Launch the MCPLab web UI and find your way around.',
  keywords: ['app', 'ui', 'launch', 'mcplab app', 'dashboard'],
  seoTitle: 'App — Starting the App',
  track: 'app',
  sections: [
    {
      id: 'launch',
      title: 'Launch the App',
      paragraphs: [
        'The mcplab app command starts a local web server and opens the UI in your browser.'
      ],
      codeBlocks: [
        { title: 'basic launch', language: 'bash', code: 'npx @inspectr/mcplab app' },
        {
          title: 'with options',
          language: 'bash',
          code: `npx @inspectr/mcplab app \\
  --evals-dir ./evals \\
  --runs-dir ./runs \\
  --libraries-dir ./libraries \\
  --port 3000 \\
  --open`
        }
      ]
    },
    {
      id: 'default-dirs',
      title: 'Default Directories',
      paragraphs: [
        'When directory flags are omitted, MCPLab looks in the current working directory for eval configs and uses ~/.mcplab/runs for run output.'
      ],
      bullets: [
        '--evals-dir defaults to the current working directory.',
        '--runs-dir defaults to mcplab/results/evaluation-runs.',
        '--libraries-dir is optional. No library is loaded if omitted.'
      ]
    },
    {
      id: 'navigation',
      title: 'Navigating the UI',
      paragraphs: ['The sidebar gives you access to all App features.'],
      bullets: [
        'Dashboard — recent runs and pass rate trends at a glance.',
        'Configurations — browse all eval configs grouped by suite, filter, and run per suite.',
        'Run Evaluation — select a config and launch an eval.',
        'Results — browse completed runs and drill into detail.',
        'MCP Tool Analysis — review MCP tool definitions for quality.',
        'Library — manage reusable agents and servers.',
        'Settings — configure API keys, preferences, and view MCP Connection Info.'
      ],
      screenshot: '/screenshots/dashboard.png'
    },
    {
      id: 'connection-info',
      title: 'MCP Connection Info',
      paragraphs: [
        'The Settings page includes a Connection Info section that shows the MCP server endpoint URL for your running MCPLab instance. It also provides ready-to-paste configuration snippets for connecting external agents — including Claude, OpenAI-compatible clients, and other MCP-aware tools — to the MCPLab MCP server.'
      ]
    }
  ]
};

const appRunning: DocPage = {
  slug: 'app-running-evaluations',
  label: 'Running Evaluations',
  href: '/docs/app/running-evaluations/',
  description: 'Launch and monitor evaluations from the web UI.',
  keywords: ['run', 'evaluation', 'ui', 'agents', 'config', 'variance'],
  seoTitle: 'App — Running Evaluations',
  track: 'app',
  sections: [
    {
      id: 'select-config',
      title: 'Select a Config',
      paragraphs: [
        'Open Run Evaluation from the sidebar. The page lists all eval configs found in the evals directory. Pick one to load its scenarios and agents.'
      ],
      screenshot: '/screenshots/run-evaluation-config.png'
    },
    {
      id: 'choose-agents',
      title: 'Choose Agents',
      paragraphs: [
        'The agent picker shows agents defined in the selected config plus any agents loaded from the library. Select one or more agents — each selected agent runs every scenario.'
      ]
    },
    {
      id: 'variance',
      title: 'Set Variance Runs',
      paragraphs: [
        'Increase the run count to execute each scenario multiple times. This surfaces consistency issues — an agent that passes 3 out of 5 runs on the same prompt is less reliable than one that passes 5 out of 5.'
      ]
    },
    {
      id: 'launch',
      title: 'Launch and Monitor',
      paragraphs: [
        'Hit Run to start the evaluation. The page shows live progress as scenarios complete. When all scenarios finish, the results are saved and you can navigate to the Result Detail.'
      ],
      screenshot: '/screenshots/run-evaluation-progress.png'
    }
  ]
};

const appConfigurations: DocPage = {
  slug: 'app-configurations',
  label: 'Configurations',
  href: '/docs/app/configurations/',
  description: 'Browse, filter, and run eval configs from the Configurations page.',
  keywords: ['configurations', 'suite', 'folder', 'filter', 'run suite', 'configs'],
  seoTitle: 'App — Configurations',
  track: 'app',
  sections: [
    {
      id: 'configurations-overview',
      title: 'The Configurations Page',
      paragraphs: [
        'The Configurations page lists all eval config files found in the evals directory. Configs are grouped by suite — the folder they live in — so related configs stay together.',
        'Each suite section is collapsible. Use the filter bar to search by config name or suite label.'
      ],
      bullets: [
        'Configs in subfolders are grouped under a suite label derived from their folder path.',
        'Each suite section can be collapsed or expanded independently.',
        'The filter bar narrows the list by name or suite in real time.'
      ]
    },
    {
      id: 'run-suite',
      title: 'Running a Suite',
      paragraphs: [
        'Each suite header includes a Run Suite button that launches all configs in that suite at once. Individual configs can also be run directly from the list.'
      ]
    }
  ]
};

const appResults: DocPage = {
  slug: 'app-reading-results',
  label: 'Analysing Results',
  href: '/docs/app/reading-results/',
  description: 'Understand run output, compare agents, and browse markdown reports.',
  keywords: ['results', 'detail', 'compare', 'agents', 'trace', 'markdown reports'],
  seoTitle: 'App — Analysing Results',
  track: 'app',
  sections: [
    {
      id: 'results-list',
      title: 'The Results List',
      paragraphs: [
        'The Results page lists every completed run in reverse chronological order. Each entry shows the config name, run note, number of scenarios, and overall pass rate.'
      ],
      screenshot: '/screenshots/evaluation-results-overview.png'
    },
    {
      id: 'result-detail',
      title: 'Result Detail',
      paragraphs: [
        "Click a run to open the Result Detail. The detail view shows per-scenario pass/fail, the tool calls the agent made, which assertions passed, and the agent's final response.",
        'Expand a scenario to inspect the full tool call trace — every LLM message and tool invocation in sequence.'
      ],
      screenshot: '/screenshots/evaluation-results-run-detail.png'
    },
    {
      id: 'compare-agents',
      title: 'Comparing Agents',
      paragraphs: [
        'When a run included multiple agents, a Compare button appears on the result. The comparison view puts all agents side by side for every scenario so you can see where they diverge.',
        'Use compare to pick the best model for your use case or to spot a regression introduced by a model update.'
      ]
    },
    {
      id: 'markdown-reports',
      title: 'Markdown Reports',
      paragraphs: [
        'MCPLab generates a summary.md for every run. The Markdown Reports section in the App lets you browse these files alongside any custom markdown reports you place in the runs directory.',
        'Useful for sharing a human-readable summary with teammates or attaching to a pull request.'
      ],
      screenshot: '/screenshots/evaluation-results-reference-reports.png'
    }
  ]
};

const appAssistants: DocPage = {
  slug: 'app-ai-assistants',
  label: 'AI Assistants',
  href: '/docs/app/ai-assistants/',
  description: 'Use the Scenario and Result AI assistants to work faster.',
  keywords: ['ai', 'assistant', 'scenario assistant', 'result assistant', 'chat'],
  seoTitle: 'App — AI Assistants',
  track: 'app',
  sections: [
    {
      id: 'scenario-assistant',
      title: 'Scenario Assistant',
      paragraphs: [
        'The Scenario Assistant is an AI chat that helps you design evaluation scenarios. Describe what you want to test in plain language and it produces a ready-to-use YAML scenario block.',
        'Use it to get a first draft of a scenario, then refine it in the chat. When you are happy, copy the YAML into your eval config.'
      ],
      bullets: [
        'Describe the goal: "I want to test that the agent calls the search tool before answering."',
        'Get a scenario with prompt, tool_constraints, and response_assertions already filled in.',
        'Iterate: "Make the assertion stricter" or "Add a forbidden_tools constraint."'
      ]
    },
    {
      id: 'result-assistant',
      title: 'Result Assistant',
      paragraphs: [
        'The Result Assistant is an AI chat that answers questions based on run data. It is available in two scopes.',
        "From a specific run (scope: run), it is scoped to that run's results, tool traces, and assertions. Default analysis flow is: search for likely matches, open focused context, then read raw artifact lines only when needed.",
        'From the Results overview (scope: all_runs), it has access to data across all runs and can answer questions about trends, regressions, and cross-run comparisons.'
      ],
      bullets: [
        'Ask: "Which scenarios failed and why?"',
        'Ask: "Did the agent call the correct tools in the right order?"',
        'Ask: "Suggest improvements to make the failing scenarios pass."',
        'Ask (all_runs scope): "Which scenarios have been consistently failing across recent runs?"',
        'Ask (all_runs scope): "How has the pass rate changed over the last five runs?"'
      ],
      screenshot: '/screenshots/evaluation-results-assistance.png'
    }
  ]
};

const appMcplabAssistantSkill: DocPage = {
  slug: 'app-mcplab-assistant-skill',
  label: 'MCPLab Assistant Skill',
  href: '/docs/app/mcplab-assistant-skill/',
  description:
    'Install and use the mcplab-assistant skill from skills.sh in Codex/Claude-style agent workflows.',
  keywords: ['mcplab-assistant', 'skills.sh', 'vercel skills', 'agent skill', 'codex', 'claude'],
  seoTitle: 'App — MCPLab Assistant Skill',
  track: 'app',
  sections: [
    {
      id: 'what-it-is',
      title: 'What This Skill Is For',
      paragraphs: [
        'The mcplab-assistant skill is an operator guide for running MCPLab workflows through an AI coding assistant. It focuses on practical operations: authoring eval config YAML, running commands, triaging failures, and interpreting run artifacts.',
        'Use it when you want consistent, deterministic help with MCPLab usage rather than generic advice.'
      ],
      bullets: [
        'Config authoring and edits for MCPLab eval files.',
        'Command help for `mcplab run`, `mcplab app`, `mcplab report`, and `mcplab results`.',
        'Failure triage for auth/config/selection/numeric-flag errors.',
        'Output analysis for `results.json`, `summary.md`, `trace.jsonl`, and `report.html`.'
      ]
    },
    {
      id: 'install',
      title: 'Install via Skills CLI',
      paragraphs: [
        'Install the skill with the Skills CLI from the source repository. This pattern is useful before or independent of a leaderboard slug.'
      ],
      codeBlocks: [
        {
          title: 'install mcplab-assistant',
          language: 'bash',
          code: 'npx skills add https://github.com/inspectr-hq/mcplab --skill mcplab-assistant'
        }
      ]
    },
    {
      id: 'use-in-chat',
      title: 'Use in Agent Chats',
      paragraphs: [
        'After installation, ask your coding agent to use the skill explicitly when working with MCPLab. Keep prompts task-focused and include file paths or command output when debugging.'
      ],
      codeBlocks: [
        {
          title: 'config authoring',
          language: 'text',
          code: 'Use the mcplab-assistant skill to draft a minimal eval config with one scenario and OAuth client-credentials auth.'
        },
        {
          title: 'run + compare',
          language: 'text',
          code: 'Use mcplab-assistant to run this config and compare claude-haiku vs gpt-4o-mini with --agents.'
        },
        {
          title: 'failure triage',
          language: 'text',
          code: 'My run fails with fetch failed. Use mcplab-assistant to triage. Here is the command, stderr, and relevant config block.'
        },
        {
          title: 'result analysis',
          language: 'text',
          code: 'Use mcplab-assistant to analyze this run directory and summarize why failing scenarios failed.'
        }
      ]
    },
    {
      id: 'verification',
      title: 'Verify Installation and Usage',
      paragraphs: ['A successful setup should satisfy all checks below.'],
      bullets: [
        'The install command completes without errors.',
        'Your agent can confirm the `mcplab-assistant` skill is available.',
        'Prompts that request the skill return MCPLab-specific, command-ready guidance.',
        'Guidance follows a deterministic structure: Intent -> Actions -> Verification -> If It Fails.'
      ]
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      bullets: [
        'Install failed: verify the GitHub URL is reachable and the skill name is exactly `mcplab-assistant`.',
        'Skill not detected by your agent: restart the agent session and re-check installed skills.',
        'Guidance is generic: explicitly request use of `mcplab-assistant` and provide config snippets/command output.',
        'Command mismatch: prioritize current MCPLab CLI contracts from local `packages/cli/src/cli.ts`.'
      ]
    }
  ]
};

const appOAuthDebugger: DocPage = {
  slug: 'app-oauth-debugger',
  label: 'OAuth Debugger',
  href: '/docs/app/oauth-debugger/',
  description: 'Debug OAuth 2.0 authorization flows for MCP servers step by step.',
  keywords: [
    'oauth debugger',
    'oauth2',
    'authorization code',
    'pkce',
    'mcp server auth',
    'oauth token'
  ],
  seoTitle: 'App — OAuth Debugger',
  track: 'app',
  sections: [
    {
      id: 'what-it-does',
      title: 'What OAuth Debugger Does',
      paragraphs: [
        'OAuth Debugger helps you inspect OAuth 2.0 authorization-code flows for MCP servers configured in your MCPLab libraries.',
        'It walks through setup, authorization, token exchange, and validation with live logs so you can find configuration and protocol issues quickly.'
      ],
      bullets: [
        'Guided flow: Configure Debug Session -> Run / Inspect Flow -> Report / Export.',
        'Supports pre-registered clients, DCR (Dynamic Client Registration), and CIMD (Client ID Metadata Document) registration methods.',
        'Includes network inspector, validation findings, and exportable traces.'
      ]
    },
    {
      id: 'before-you-start',
      title: 'Before You Start',
      paragraphs: [
        'OAuth Debugger shows servers that are configured with OAuth 2.0 auth in your Libraries.',
        'If no servers appear, add or update a server in Library / Servers with OAuth 2.0 settings first.'
      ],
      bullets: [
        'Open the app with `npx @inspectr/mcplab app`.',
        'In the sidebar, open Lab -> OAuth Debugger.',
        'Ensure your server config includes OAuth authorization-code fields.'
      ]
    },
    {
      id: 'run-a-session',
      title: 'Run a Debug Session',
      paragraphs: [
        'Create a session, start the flow, complete browser authorization, then inspect results.'
      ],
      bullets: [
        'Select target MCP server (OAuth-enabled only).',
        'Choose registration method: pre_registered, dcr (Dynamic Client Registration), or cimd (Client ID Metadata Document).',
        'Set runtime options like redirect mode and PKCE.',
        'Start session and open the generated authorization URL.',
        'If required, paste the final redirect URL in manual callback mode.',
        'Review step states, event stream, and request/response inspector.'
      ]
    },
    {
      id: 'inspect-and-export',
      title: 'Inspect and Export Results',
      paragraphs: [
        'After completion (or failure), use Report / Export to review summarized values, validation findings, and full traces.'
      ],
      bullets: [
        'Export formats: JSON, Markdown, and raw trace.',
        'Review key values like issuer, redirect URI, scopes, token endpoint status, and token type.',
        'Copy access token from report when visible and use it for CLI runs.'
      ],
      codeBlocks: [
        {
          title: 'run eval with OAuth token from debugger',
          language: 'bash',
          code: 'npx @inspectr/mcplab run -c eval.yaml --oauth-token my-server=<access-token>'
        }
      ]
    },
    {
      id: 'common-issues',
      title: 'Common Issues',
      bullets: [
        'No server listed: verify server auth is OAuth 2.0 in Library / Servers.',
        'Waiting for callback: complete authorization in browser or submit manual callback URL.',
        'Token exchange errors: verify token endpoint, client auth method, and redirect URI.',
        'Validation warnings: use spec reference links and apply suggested improvements from findings.'
      ]
    }
  ]
};

const appScenarioSetup: DocPage = {
  slug: 'app-scenario-setup',
  label: 'Scenario Setup in the App',
  href: '/docs/app/scenario-setup/',
  description: 'Create and manage evaluation scenarios directly in the MCPLab app UI.',
  keywords: [
    'scenario setup',
    'config editor',
    'mcp evaluations',
    'inline scenario',
    'scenario reference',
    'app workflow'
  ],
  seoTitle: 'App — Scenario Setup',
  track: 'app',
  sections: [
    {
      id: 'open-editor',
      title: 'Open the Config Editor',
      paragraphs: [
        'In the app sidebar, open MCP Evaluations, then click Create New (or edit an existing evaluation).',
        'The editor opens with tabs for Scenarios and Agents. Use Scenarios to build the test cases in your evaluation config.'
      ],
      bullets: [
        'Path: Lab -> MCP Evaluations -> Create New.',
        'Existing configs: open a row and click Edit.',
        'Use Name/Description fields to document the evaluation purpose.'
      ]
    },
    {
      id: 'add-scenarios',
      title: 'Add Scenarios (Reference or Inline)',
      paragraphs: [
        'The Scenarios tab supports three entry methods so you can mix reusable library scenarios with config-specific inline scenarios.'
      ],
      bullets: [
        'Add Ref: reference a scenario from the scenario library.',
        'Referenced rows can define `mcp_servers` override to swap target server without duplicating the test-case.',
        'Import Inline: copy a library scenario into this config for local customization.',
        'Add scenario: create a brand-new inline scenario from scratch.'
      ]
    },
    {
      id: 'edit-inline',
      title: 'Edit Inline Scenario Details',
      paragraphs: [
        'Expand an inline scenario row to edit prompt, server bindings, tool constraints, assertions, and extraction rules through the scenario form.',
        'Inline scenarios require a name before saving. Keep names unique and descriptive for easier run analysis.'
      ],
      bullets: [
        'Click the chevron on an inline row to expand details.',
        'Use concise, deterministic prompts first, then tighten assertions.',
        'Save after each meaningful scenario change to keep diffs reviewable.'
      ]
    },
    {
      id: 'organize-list',
      title: 'Organize and Normalize Scenario Entries',
      bullets: [
        'Use up/down arrows to reorder scenario execution.',
        'Use Convert to inline to copy a referenced scenario into editable inline form.',
        'Referenced rows show Override badge when `mcp_servers` override is active.',
        'Use Remove to drop scenarios you no longer need.',
        'Fix Missing badges for broken references before running.'
      ]
    },
    {
      id: 'run-from-app',
      title: 'Run and Validate from the App',
      paragraphs: [
        'After saving, open Run Evaluation, choose your config, select scenarios and agents, then execute a baseline run.',
        'Start with one scenario and one run to validate setup before scaling to more scenarios or higher variance.'
      ],
      bullets: [
        'Use scenario selection to isolate failures quickly.',
        'Use Results and Result Detail to verify assertions and tool usage.',
        'Iterate in Config Editor, save, and rerun until the baseline is stable.'
      ]
    }
  ]
};

const appToolAnalysis: DocPage = {
  slug: 'app-tool-analysis',
  label: 'MCP Tool Analysis',
  href: '/docs/app/tool-analysis/',
  description: 'Review MCP tool definitions for quality and LLM-readiness.',
  keywords: ['tool analysis', 'quality', 'mcp tools', 'review', 'llm-friendly'],
  seoTitle: 'App — MCP Tool Analysis',
  track: 'app',
  sections: [
    {
      id: 'what-it-checks',
      title: 'What MCP Tool Analysis Checks',
      paragraphs: [
        'MCPLab can analyse the tool definitions your MCP server exposes and report on their quality from an LLM perspective. Poor tool descriptions lead to agents calling the wrong tool or passing incorrect parameters.'
      ],
      bullets: [
        'Description quality — is the tool description clear and specific enough for an LLM to know when to use it?',
        'Parameter documentation — are all parameters described with types and examples?',
        'Output schema contract — does structured output align with the tool output schema for reliable agent parsing?',
        'Naming — does the tool name clearly indicate its purpose?',
        'Safety — does the tool expose operations that could be misused?'
      ]
    },
    {
      id: 'running-analysis',
      title: 'Running an Analysis',
      paragraphs: [
        'Open Tool Analysis from the sidebar and connect to an MCP server. MCPLab fetches the tool list and sends it to the AI reviewer. The analysis takes a few seconds.'
      ],
      screenshot: '/screenshots/analyze-mcp-tools-progress.png'
    },
    {
      id: 'reading-results',
      title: 'Reading Results',
      paragraphs: [
        'Results are grouped by severity: critical issues that will likely cause incorrect agent behaviour, warnings that reduce reliability, and informational suggestions.',
        'Each finding includes the affected tool, a description of the issue, and a concrete recommendation.'
      ],
      screenshot: '/screenshots/mcp-analysis-result-detail.png'
    },
    {
      id: 'persisted-reports',
      title: 'Persisted Reports',
      paragraphs: [
        'Completed analyses are saved and appear in the Analysis Reports list. Browse past reports to track quality improvements over time as you update your tool definitions.'
      ],
      screenshot: '/screenshots/mcp-analysis-results-list.png'
    }
  ]
};

const appLibrary: DocPage = {
  slug: 'app-library',
  label: 'Library',
  href: '/docs/app/library/',
  description: 'Manage reusable agents and servers shared across eval configs.',
  keywords: ['library', 'agents', 'servers', 'reusable', 'shared', 'libraries-dir'],
  seoTitle: 'App — Library',
  track: 'app',
  sections: [
    {
      id: 'what-the-library-is',
      title: 'What the Library Is',
      paragraphs: [
        'The library is a directory of shared YAML files — agents.yaml and servers.yaml — that MCPLab loads at startup. Library items are available across all eval configs without duplicating their definitions.',
        'This is useful when you have a standard set of agents (e.g. one per model you test) or servers (e.g. staging and production endpoints) that you want to reference from many configs.'
      ]
    },
    {
      id: 'loading-library',
      title: 'Loading the Library',
      paragraphs: [
        'Pass --libraries-dir when starting the App to point it at your library directory.'
      ],
      codeBlocks: [
        {
          title: 'start app with library',
          language: 'bash',
          code: 'npx @inspectr/mcplab app --libraries-dir ./libraries'
        }
      ]
    },
    {
      id: 'library-in-ui',
      title: 'Library Items in the UI',
      paragraphs: [
        'Library agents appear in the agent picker on the Run Evaluation page alongside agents defined in the selected config. Library servers appear in the server list when editing a config.',
        'The Library section in the sidebar shows all loaded agents and servers with their full definitions.'
      ],
      screenshot: '/screenshots/agents-library.png'
    },
    {
      id: 'managing-files',
      title: 'Managing Library Files',
      paragraphs: [
        'Edit agents.yaml and servers.yaml directly in your library directory. The App reads them at startup — restart the App after making changes to pick up updates.',
        'For the YAML syntax for referencing library items from eval configs, see the CLI / Configuration documentation.'
      ]
    }
  ]
};

// ─── Reference ────────────────────────────────────────────────────────────────

const refConfiguration: DocPage = {
  slug: 'reference-configuration',
  label: 'Configuration Schema',
  href: '/docs/reference/configuration/',
  description: 'Complete field reference for eval.yaml.',
  keywords: ['schema', 'reference', 'fields', 'yaml', 'config', 'full reference'],
  seoTitle: 'Reference — Configuration Schema',
  track: 'reference',
  sections: [
    {
      id: 'servers-schema',
      title: 'servers[ ]',
      bullets: [
        'id (string, required) — unique identifier used in scenario server lists.',
        'transport (string, required) — connection type. Use "http" for HTTP/SSE.',
        'url (string, required) — full URL of the MCP endpoint.',
        'token (string, optional) — bearer token for authentication. Use a literal string or $ENV_VAR to read from the environment.'
      ]
    },
    {
      id: 'agents-schema',
      title: 'agents[ ]',
      bullets: [
        'id (string, required) — unique identifier referenced by scenarios.',
        'provider (string, required) — LLM provider. One of: anthropic, openai, azure.',
        'model (string, required) — model identifier as used by the provider API.',
        'temperature (number, optional) — sampling temperature. Defaults to 0.'
      ]
    },
    {
      id: 'scenarios-schema',
      title: 'scenarios[ ]',
      bullets: [
        'Inline scenario: `id`, `prompt`, optional `name`, optional `mcp_servers`, optional `eval` and `extract`.',
        'Referenced scenario: `ref` with optional `mcp_servers` override.',
        '`mcp_servers` entries can be `{ ref: <server-id> }` or inline server objects.',
        'Legacy top-level `servers` pool is deprecated; prefer scenario-owned `mcp_servers`.'
      ]
    },
    {
      id: 'assertions-schema',
      title: 'eval.tool_constraints and eval.response_assertions',
      bullets: [
        'tool_constraints.required_tools (string[], optional) — tool names the agent must call.',
        'tool_constraints.forbidden_tools (string[], optional) — tool names the agent must not call.',
        'response_assertions supports: contains, not_contains, starts_with, ends_with, equals, regex, jsonpath, jsonpath_exists, jsonpath_not_exists.',
        'For detailed examples of each assertion, see Reference / Tool and Response Assertions.'
      ]
    },
    {
      id: 'refs-schema',
      title: 'Reference Syntax',
      paragraphs: [
        'Use `ref` inside `agents` and `scenarios` list items to pull from library ids.'
      ],
      codeBlocks: [
        {
          title: 'referenced scenario with mcp override',
          language: 'yaml',
          code: `agents:
  - ref: claude-sonnet-46

scenarios:
  - ref: add-calculations
    mcp_servers:
      - ref: kpi-api-prod`
        }
      ]
    }
  ]
};

const refToolAndResponseAssertions: DocPage = {
  slug: 'reference-tool-and-response-assertions',
  label: 'Tool and Response Assertions',
  href: '/docs/reference/tool-and-response-assertions/',
  description:
    'Complete assertion guide with examples for tool checks, response checks, and semantic agent checks.',
  keywords: [
    'assertions',
    'tool constraints',
    'tool sequence',
    'response assertions',
    'agent checks',
    'jsonpath',
    'regex',
    'contains'
  ],
  seoTitle: 'Reference — Tool and Response Assertions',
  track: 'reference',
  sections: [
    {
      id: 'decision-guide',
      title: 'When To Use Tool vs Response Assertions',
      bullets: [
        'Use tool assertions when behavior depends on action correctness (which tools were called, and in which order).',
        'Use response assertions when behavior depends on final answer quality or format.',
        'Use agent checks when the validation is semantic or fuzzy and strict string/regex checks would be too brittle.',
        'Use both together for high-confidence checks: action correctness plus answer correctness.'
      ]
    },
    {
      id: 'tool-assertions',
      title: 'Tool Assertions',
      paragraphs: [
        'Tool assertions validate whether the agent used the right tools and sequence of calls.'
      ],
      codeBlocks: [
        {
          title: 'required and forbidden tools',
          language: 'yaml',
          code: `eval:
  tool_constraints:
    required_tools: [lookup_account, verify_identity]
    forbidden_tools: [delete_account]`
        },
        {
          title: 'allowed tool sequences',
          language: 'yaml',
          code: `eval:
  tool_sequence:
    allow:
      - [lookup_account, verify_identity, process_refund]
      - [lookup_account, verify_identity, check_policy, process_refund]`
        }
      ]
    },
    {
      id: 'response-assertions',
      title: 'Response Assertions',
      paragraphs: [
        'String response assertions are literal checks and are case-insensitive by default. Use regex only when you need pattern matching.'
      ],
      codeBlocks: [
        {
          title: 'contains',
          language: 'yaml',
          code: `eval:
  response_assertions:
    - type: contains
      value: refund processed`
        },
        {
          title: 'not_contains',
          language: 'yaml',
          code: `eval:
  response_assertions:
    - type: not_contains
      value: internal error`
        },
        {
          title: 'starts_with',
          language: 'yaml',
          code: `eval:
  response_assertions:
    - type: starts_with
      value: hello`
        },
        {
          title: 'ends_with',
          language: 'yaml',
          code: `eval:
  response_assertions:
    - type: ends_with
      value: thank you`
        },
        {
          title: 'equals',
          language: 'yaml',
          code: `eval:
  response_assertions:
    - type: equals
      value: success`
        },
        {
          title: 'regex',
          language: 'yaml',
          code: `eval:
  response_assertions:
    - type: regex
      pattern: "refund\\s+(processed|completed)"`
        },
        {
          title: 'jsonpath (exists or equals)',
          language: 'yaml',
          code: `eval:
  response_assertions:
    - type: jsonpath
      path: $.status
    - type: jsonpath
      path: $.status
      equals: success`
        },
        {
          title: 'jsonpath_exists',
          language: 'yaml',
          code: `eval:
  response_assertions:
    - type: jsonpath_exists
      path: $.data.id`
        },
        {
          title: 'jsonpath_not_exists',
          language: 'yaml',
          code: `eval:
  response_assertions:
    - type: jsonpath_not_exists
      path: $.error`
        }
      ]
    },
    {
      id: 'agent-checks',
      title: 'Agent Checks',
      paragraphs: [
        'Agent checks use a workspace-configured judge model to evaluate the final answer against a short freeform instruction. They are useful for semantic validation such as “does this answer include a valid time range?” when deterministic string checks are too rigid.'
      ],
      codeBlocks: [
        {
          title: 'agent_assertions',
          language: 'yaml',
          code: `eval:
  agent_assertions:
    - label: logical_time_range
      prompt: Confirm the final answer includes an earliest and latest timestamp, and that both values are present and logically ordered.`
        }
      ]
    },
    {
      id: 'behavior-notes',
      title: 'Behavior Notes and Edge Cases',
      bullets: [
        'contains/not_contains/starts_with/ends_with/equals are literal, case-insensitive string checks.',
        'regex is case-insensitive by default and uses JavaScript regular expressions.',
        'jsonpath/jsonpath_exists/jsonpath_not_exists require valid JSON in the final response.',
        'If final response is not valid JSON, JSONPath assertions fail with an invalid JSON error.',
        'Agent checks judge final answer text only in v1 and require a default evaluation judge to be configured in workspace settings.',
        'Agent checks are more flexible, but they are also less reproducible and more expensive than deterministic checks.'
      ]
    }
  ]
};

const refEnvVars: DocPage = {
  slug: 'reference-env-vars',
  label: 'Environment Variables',
  href: '/docs/reference/environment-variables/',
  description: 'All environment variables read by MCPLab.',
  keywords: ['env', 'environment', 'api key', 'secrets', 'variables'],
  seoTitle: 'Reference — Environment Variables',
  track: 'reference',
  sections: [
    {
      id: 'provider-keys',
      title: 'Provider API Keys',
      bullets: [
        'ANTHROPIC_API_KEY — required when using provider: anthropic.',
        'OPENAI_API_KEY — required when using provider: openai.',
        'AZURE_OPENAI_API_KEY — required when using provider: azure.',
        'AZURE_OPENAI_ENDPOINT — required when using provider: azure. Full resource URL.',
        'AZURE_OPENAI_DEPLOYMENT — required when using provider: azure. Deployment name.'
      ],
      codeBlocks: [
        {
          title: 'Anthropic .env',
          language: 'bash',
          code: `ANTHROPIC_API_KEY=sk-ant-api03-...`
        },
        {
          title: 'OpenAI .env',
          language: 'bash',
          code: `OPENAI_API_KEY=sk-proj-...`
        },
        {
          title: 'Azure OpenAI .env',
          language: 'bash',
          code: `AZURE_OPENAI_API_KEY=your-azure-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your-deployment-name`
        }
      ]
    },
    {
      id: 'bearer-tokens',
      title: 'Bearer Token References',
      paragraphs: [
        'Any environment variable name can be used as a bearer token reference in a server definition. The variable name (without the $ prefix) is looked up at runtime.'
      ],
      codeBlocks: [
        {
          title: 'example',
          language: 'yaml',
          code: `servers:
  - id: my-server
    transport: http
    url: https://api.example.com/mcp
    token: $MY_SERVER_TOKEN   # reads process.env.MY_SERVER_TOKEN`
        }
      ]
    }
  ]
};

// ─── Exports ──────────────────────────────────────────────────────────────────

const pageIndex: DocPage[] = [
  overview,
  installation,
  quickStart,
  setupEvaluations,
  scenarioConfiguration,
  librariesAndRefs,
  cliRunning,
  cliConfiguration,
  cliReports,
  cliResultsQuery,
  cliCicd,
  cliCommandReference,
  appGettingStarted,
  appConfigurations,
  appRunning,
  appResults,
  appAssistants,
  appMcplabAssistantSkill,
  appOAuthDebugger,
  appScenarioSetup,
  appToolAnalysis,
  appLibrary,
  refConfiguration,
  refToolAndResponseAssertions,
  refEnvVars
];

export const docsPages = pageIndex;

export const docsNavSections = [
  {
    title: 'Getting Started',
    items: [
      overview,
      installation,
      quickStart,
      setupEvaluations,
      scenarioConfiguration,
      librariesAndRefs
    ]
  },
  {
    title: 'CLI',
    items: [cliRunning, cliConfiguration, cliReports, cliResultsQuery, cliCicd, cliCommandReference]
  },
  {
    title: 'App',
    items: [
      appGettingStarted,
      appConfigurations,
      appRunning,
      appResults,
      appAssistants,
      appMcplabAssistantSkill,
      appOAuthDebugger,
      appScenarioSetup,
      appToolAnalysis,
      appLibrary
    ]
  },
  {
    title: 'Reference',
    items: [refConfiguration, refToolAndResponseAssertions, refEnvVars]
  }
] as const;

export const docsSearchItems = docsNavSections.flatMap((section) => section.items);

export function getDocPageBySlug(slug: string) {
  return docsPages.find((page) => page.slug === slug);
}
