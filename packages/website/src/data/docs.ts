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
  href: '/docs',
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
  href: '/docs/installation',
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
  href: '/docs/quick-start',
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

// ─── CLI Track ────────────────────────────────────────────────────────────────

const cliRunning: DocPage = {
  slug: 'cli-running-evaluations',
  label: 'Running Evaluations',
  href: '/docs/cli/running-evaluations',
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
        'By default all agents defined in the config are used. Narrow the selection with --agents or expand to include all agents defined in the library with --agents-all.'
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
  href: '/docs/cli/configuration',
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
        'An eval file has three required top-level keys: servers, agents, and scenarios.'
      ],
      codeBlocks: [
        {
          title: 'eval.yaml skeleton',
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
        'Each scenario has an id, a list of servers to give the agent access to, a prompt describing the task, and an eval block with assertions.',
        'The agent field is optional — when omitted all agents in the config run the scenario.'
      ],
      codeBlocks: [
        {
          title: 'scenario',
          language: 'yaml',
          code: `scenarios:
  - id: weather-lookup
    servers: [weather-server]
    prompt: What is the current weather in Amsterdam?
    eval:
      tool_constraints:
        required_tools: [get_weather]
        forbidden_tools: [send_email]
      response_assertions:
        - type: regex
          pattern: "Amsterdam"
        - type: contains
          value: "temperature"`
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
        'response_assertions type: contains — the agent response must contain the exact string in value.'
      ]
    },
    {
      id: 'refs',
      title: 'Reusable Refs',
      paragraphs: [
        'Use $ref to reference a server or agent definition from a separate file instead of repeating it across configs.'
      ],
      codeBlocks: [
        {
          title: 'servers.yaml (shared library file)',
          language: 'yaml',
          code: `servers:
  - id: my-server
    transport: http
    url: http://localhost:3000/mcp`
        },
        {
          title: 'eval.yaml using a library ref',
          language: 'yaml',
          code: `servers:
  - $ref: servers.yaml#my-server

agents:
  - id: claude
    provider: anthropic
    model: claude-haiku-4-5-20251001

scenarios:
  - id: basic-test
    servers: [my-server]
    prompt: Complete the task.`
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
  href: '/docs/cli/reports-output',
  description: 'What MCPLab writes after a run and how to work with it.',
  keywords: ['reports', 'output', 'results', 'trace', 'html', 'json', 'mcplab report'],
  seoTitle: 'CLI — Reports & Output',
  track: 'cli',
  sections: [
    {
      id: 'run-directory',
      title: 'Run Directory',
      paragraphs: [
        'Every mcplab run creates a timestamped directory under runs/ (or --runs-dir if set). The directory contains four files.'
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

const cliCicd: DocPage = {
  slug: 'cli-ci-cd',
  label: 'CI/CD',
  href: '/docs/cli/ci-cd',
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

// ─── App Track ────────────────────────────────────────────────────────────────

const appGettingStarted: DocPage = {
  slug: 'app-getting-started',
  label: 'Starting the App',
  href: '/docs/app/getting-started',
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
        '--runs-dir defaults to ~/.mcplab/runs.',
        '--libraries-dir is optional. No library is loaded if omitted.'
      ]
    },
    {
      id: 'navigation',
      title: 'Navigating the UI',
      paragraphs: ['The sidebar gives you access to all App features.'],
      bullets: [
        'Dashboard — recent runs and pass rate trends at a glance.',
        'Run Evaluation — select a config and launch an eval.',
        'Results — browse completed runs and drill into detail.',
        'MCP Tool Analysis — review MCP tool definitions for quality.',
        'Library — manage reusable agents and servers.',
        'Settings — configure API keys and preferences.'
      ],
      screenshot: '/screenshots/dashboard.png'
    }
  ]
};

const appRunning: DocPage = {
  slug: 'app-running-evaluations',
  label: 'Running Evaluations',
  href: '/docs/app/running-evaluations',
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

const appResults: DocPage = {
  slug: 'app-reading-results',
  label: 'Analysing Results',
  href: '/docs/app/reading-results',
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
  href: '/docs/app/ai-assistants',
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
        'The Result Assistant is an AI chat scoped to a specific completed run. Ask it questions about the results and it answers based on the run data.',
        'Use it to understand failures quickly without manually reading through trace files.'
      ],
      bullets: [
        'Ask: "Which scenarios failed and why?"',
        'Ask: "Did the agent call the correct tools in the right order?"',
        'Ask: "Suggest improvements to make the failing scenarios pass."'
      ],
      screenshot: '/screenshots/evaluation-results-assistance.png'
    }
  ]
};

const appToolAnalysis: DocPage = {
  slug: 'app-tool-analysis',
  label: 'MCP Tool Analysis',
  href: '/docs/app/tool-analysis',
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
  href: '/docs/app/library',
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
  href: '/docs/reference/configuration',
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
        'id (string, required) — unique identifier for the scenario.',
        'servers (string[], required) — list of server ids to give the agent access to.',
        'prompt (string, required) — the task description sent to the agent.',
        'agent (string, optional) — id of a specific agent to run. When omitted all agents run this scenario.',
        'eval (object, optional) — assertions to check after the agent completes.'
      ]
    },
    {
      id: 'assertions-schema',
      title: 'eval.tool_constraints and eval.response_assertions',
      bullets: [
        'tool_constraints.required_tools (string[], optional) — tool names the agent must call.',
        'tool_constraints.forbidden_tools (string[], optional) — tool names the agent must not call.',
        'response_assertions[ ].type: "regex" — agent response must match pattern.',
        'response_assertions[ ].type: "contains" — agent response must contain value.'
      ]
    },
    {
      id: 'refs-schema',
      title: '$ref Syntax',
      paragraphs: [
        'Use $ref inside a servers or agents list item to pull in a definition from an external YAML file.'
      ],
      codeBlocks: [
        {
          title: 'example',
          language: 'yaml',
          code: `servers:
  - $ref: ./shared/servers.yaml#my-server`
        }
      ]
    }
  ]
};

const refEnvVars: DocPage = {
  slug: 'reference-env-vars',
  label: 'Environment Variables',
  href: '/docs/reference/environment-variables',
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
  cliRunning,
  cliConfiguration,
  cliReports,
  cliCicd,
  appGettingStarted,
  appRunning,
  appResults,
  appAssistants,
  appToolAnalysis,
  appLibrary,
  refConfiguration,
  refEnvVars
];

export const docsPages = pageIndex;

export const docsNavSections = [
  {
    title: 'Getting Started',
    items: [overview, installation, quickStart]
  },
  {
    title: 'CLI',
    items: [cliRunning, cliConfiguration, cliReports, cliCicd]
  },
  {
    title: 'App',
    items: [appGettingStarted, appRunning, appResults, appAssistants, appToolAnalysis, appLibrary]
  },
  {
    title: 'Reference',
    items: [refConfiguration, refEnvVars]
  }
] as const;

export const docsSearchItems = docsNavSections.flatMap((section) => section.items);

export function getDocPageBySlug(slug: string) {
  return docsPages.find((page) => page.slug === slug);
}
