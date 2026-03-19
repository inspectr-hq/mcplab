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
};

export type DocPage = DocNavItem & {
  slug: string;
  seoTitle: string;
  sections: DocSection[];
};

const pageIndex = [
  {
    slug: 'overview',
    label: 'Overview',
    href: '/docs',
    description: 'Start here and scan the docs map.',
    keywords: ['documentation', 'overview', 'start', 'guide'],
    seoTitle: 'Documentation',
    sections: [
      {
        id: 'docs-overview',
        title: 'Documentation',
        paragraphs: [
          'MCPLab helps you evaluate MCP servers with reproducible scenarios, model comparisons, and detailed traces.',
          'This documentation is organized around the core workflow: install the CLI, define a config, run an eval, inspect the report, and use the app mode tools when you need guided analysis.',
        ],
        bullets: [
          'Install the CLI locally or run it with npx.',
          'Describe servers, agents, and scenarios in YAML.',
          'Run evaluations from the terminal or the app mode UI.',
          'Track results with HTML reports, JSON output, and traces.',
        ],
      },
    ],
  },
  {
    slug: 'installation',
    label: 'Installation',
    href: '/docs/installation',
    description: 'Install MCPLab with npx or globally.',
    keywords: ['install', 'npx', 'global', 'setup'],
    seoTitle: 'Installation',
    sections: [
      {
        id: 'install',
        title: 'Install',
        paragraphs: [
          'Use npx when you want the fastest path to a working install.',
          'Install globally if you prefer a local command on your PATH.',
        ],
        codeBlocks: [
          { title: 'npx', language: 'bash', code: 'npx @inspectr/mcplab --help' },
          { title: 'global', language: 'bash', code: 'npm install -g @inspectr/mcplab' },
        ],
      },
      {
        id: 'environment',
        title: 'Set Up Environment',
        paragraphs: [
          'Copy the example environment file and add the provider keys your evals need.',
        ],
        codeBlocks: [
          { title: '.env', language: 'bash', code: 'cp .env.example .env\n# Add ANTHROPIC_API_KEY / OPENAI_API_KEY / AZURE_OPENAI_* values' },
        ],
      },
    ],
  },
  {
    slug: 'quick-start',
    label: 'Quick Start',
    href: '/docs/quick-start',
    description: 'Create your first evaluation file.',
    keywords: ['quick start', 'first eval', 'yaml', 'scenario'],
    seoTitle: 'Quick Start',
    sections: [
      {
        id: 'create-config',
        title: 'Create an Eval Config',
        paragraphs: [
          'Define servers, agents, and scenarios in a single YAML file.',
          'The example below is intentionally small so you can get a first run working before adding more advanced checks.',
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
          pattern: success|completed`,
          },
        ],
      },
      {
        id: 'run-it',
        title: 'Run It',
        paragraphs: ['Execute the eval and inspect the generated report afterward.'],
        codeBlocks: [{ title: 'terminal', language: 'bash', code: 'npx @inspectr/mcplab run -c eval.yaml' }],
      },
    ],
  },
  {
    slug: 'configuration',
    label: 'Configuration',
    href: '/docs/configuration',
    description: 'Understand servers, agents, and scenarios.',
    keywords: ['config', 'servers', 'agents', 'scenarios', 'yaml'],
    seoTitle: 'Configuration',
    sections: [
      {
        id: 'structure',
        title: 'Structure Overview',
        paragraphs: [
          'An eval file contains three primary sections: servers, agents, and scenarios.',
          'Servers describe the MCP endpoints to test, agents describe the models that will run the scenarios, and scenarios describe the tasks and assertions.',
        ],
        codeBlocks: [
          {
            title: 'structure',
            language: 'yaml',
            code: `servers:
  - id: local-server
    transport: http
    url: http://localhost:3000/mcp

agents:
  - id: claude
    provider: anthropic
    model: claude-sonnet-4-6

scenarios:
  - id: basic-test
    servers: [local-server]
    prompt: ...
    eval: ...`,
          },
        ],
      },
      {
        id: 'advanced-config',
        title: 'Common Patterns',
        bullets: [
          'Use auth blocks for bearer token, API key, or OAuth client credentials.',
          'Use refs when you want to reuse shared server, agent, or scenario definitions.',
          'Add variance runs and response assertions when you need stronger regression coverage.',
        ],
      },
    ],
  },
  {
    slug: 'usage',
    label: 'Usage',
    href: '/docs/usage',
    description: 'Run evals, compare agents, and generate reports.',
    keywords: ['usage', 'run', 'watch', 'reports', 'compare'],
    seoTitle: 'Usage',
    sections: [
      {
        id: 'basic-usage',
        title: 'Basic Usage',
        codeBlocks: [
          { title: 'run all scenarios', language: 'bash', code: 'mcplab run -c eval.yaml' },
          { title: 'run a specific scenario', language: 'bash', code: 'mcplab run -c eval.yaml --scenario basic-test' },
          { title: 'watch mode', language: 'bash', code: 'mcplab watch -c eval.yaml' },
        ],
      },
      {
        id: 'reports',
        title: 'Reports and Outputs',
        paragraphs: [
          'Every run can emit JSON results, JSONL traces, a summary report, and an HTML report.',
          'Use those artifacts to compare models, inspect tool sequences, and spot regressions over time.',
        ],
      },
    ],
  },
  {
    slug: 'app-mode',
    label: 'App Mode',
    href: '/docs/app-mode',
    description: 'Use the guided UI for analysis and assistance.',
    keywords: ['app mode', 'assistant', 'analysis', 'ui'],
    seoTitle: 'App Mode',
    sections: [
      {
        id: 'app-mode',
        title: 'Guided Analysis',
        paragraphs: [
          'App mode wraps the CLI workflow in a focused UI for faster inspection and iteration.',
          'It is especially useful when you want scenario assistance, result analysis, or MCP tool review without jumping between terminal output and report files.',
        ],
        bullets: [
          'Scenario Assistant helps you shape new evals.',
          'Result Assistant explains failures and patterns.',
          'MCP Tool Analysis reviews tool definitions for quality and LLM-friendliness.',
        ],
      },
    ],
  },
  {
    slug: 'development',
    label: 'Development',
    href: '/docs/development',
    description: 'Work on MCPLab locally.',
    keywords: ['development', 'build', 'tests', 'workspace'],
    seoTitle: 'Development',
    sections: [
      {
        id: 'workspace',
        title: 'Workspace Layout',
        bullets: [
          'packages/cli contains the command-line entrypoint.',
          'packages/core contains the evaluation engine and configuration parsing.',
          'packages/website contains this static Astro site.',
        ],
      },
      {
        id: 'local-dev',
        title: 'Run Locally',
        codeBlocks: [
          { title: 'website', language: 'bash', code: 'npm run dev -w @inspectr/mcplab-website' },
          { title: 'build', language: 'bash', code: 'npm run build -w @inspectr/mcplab-website' },
          { title: 'tests', language: 'bash', code: 'npm run test -w @inspectr/mcplab-website' },
        ],
      },
    ],
  },
] satisfies DocPage[];

export const docsPages = pageIndex;

export const docsNavSections = [
  {
    title: 'Getting Started',
    items: [pageIndex[0], pageIndex[1], pageIndex[2], pageIndex[3]],
  },
  {
    title: 'Guides',
    items: [pageIndex[4], pageIndex[5], pageIndex[6]],
  },
] as const;

export const docsSearchItems = docsNavSections.flatMap((section) => section.items);

export function getDocPageBySlug(slug: string) {
  return docsPages.find((page) => page.slug === slug);
}
