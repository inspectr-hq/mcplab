# MCPLab 🧪

> **Lab for testing Model Context Protocol servers with LLMs**

Test how well LLM agents use your MCP tools, compare different models, and track quality over time with automated testing and detailed reports.

---

## 🎯 What is MCPLab?

MCPLab is a testing and evaluation framework for [MCP servers](https://modelcontextprotocol.io). It helps you:

- **Validate** that LLM agents correctly use your MCP tools
- **Compare** different LLMs (Claude, GPT-4, etc.) on the same tasks
- **Track** tool usage patterns, success rates, and performance metrics
- **Automate** quality assurance in CI/CD pipelines
- **Debug** agent behavior with detailed execution traces

Perfect for MCP server developers who want to ensure their tools work reliably across different AI models.

---

## ✨ Features

### Core Capabilities
- 🔌 **HTTP SSE Transport** - Test MCP servers over Streamable HTTP
- 🤖 **Multi-LLM Support** - OpenAI, Anthropic Claude, Azure OpenAI
- 📊 **Rich Assertions** - Validate tool usage, sequences, and response content
- 📈 **Variance Testing** - Run multiple iterations to measure stability
- 🔍 **Detailed Traces** - JSONL logs of every tool call and LLM response

### Developer Experience
- 👀 **Watch Mode** - Auto-rerun tests when configs change
- 📝 **YAML Configuration** - Declarative, version-controllable test specs
- 🎨 **Interactive Reports** - Self-contained HTML with filtering and drill-down
- 🔄 **Multi-Agent Testing** - Compare LLMs with a single CLI flag
- 🧪 **Scenario Isolation** - Run specific tests or full suites

### Analysis & Reporting
- 📉 **Trend Analysis** - Track pass rates and performance over time
- 🆚 **LLM Comparison** - Built-in tools to compare agent behavior
- 📄 **Multiple Outputs** - HTML report, JSON results, Markdown summary, JSONL trace
- 🎯 **Custom Metrics** - Extract values and track domain-specific KPIs

---

## 🚀 Quick Start

### 1. Install

```bash
git clone https://github.com/yourusername/mcp-lab.git
cd mcp-lab
npm install
npm run build
```

### 2. Set up environment

```bash
cp .env.example .env
# Edit .env and add your API keys:
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
```

### 3. Run your first evaluation

```bash
# Run the app (frontend + local API bridge)
mcplab app --configs-dir configs --runs-dir runs --open

# Run an evaluation from config files
mcplab run -c configs/eval.yaml

# View the results
open runs/$(ls -t runs | head -1)/report.html
```

### 4. Create your own test

Create `my-eval.yaml`:

```yaml
servers:
  my-server:
    transport: "http"
    url: "http://localhost:3000/mcp"

agents:
  claude:
    provider: "anthropic"
    model: "claude-3-haiku-20240307"
    temperature: 0
    max_tokens: 2048

scenarios:
  - id: "basic-test"
    agent: "claude"
    servers: ["my-server"]
    prompt: "Use the available tools to complete this task..."
    eval:
      tool_constraints:
        required_tools: ["my_tool"]
      response_assertions:
        - type: "regex"
          pattern: "success|completed"
```

Run it:

```bash
mcplab run -c my-eval.yaml
```

---

## 📖 Configuration Guide

### Structure Overview

```yaml
servers:     # MCP servers to test against
  ...

agents:      # LLM agents to use for testing
  ...

scenarios:   # Test scenarios to run
  ...
```

### Servers

Define MCP servers with connection details and authentication:

```yaml
servers:
  my-server:
    transport: "http"
    url: "https://api.example.com/mcp"
    auth:
      type: "bearer"           # or "oauth_client_credentials"
      env: "MCP_TOKEN"         # Environment variable name
```

**Authentication types:**

**Bearer Token:**
```yaml
auth:
  type: "bearer"
  env: "MCP_TOKEN"  # Reads from process.env.MCP_TOKEN
```

**OAuth Client Credentials:**
```yaml
auth:
  type: "oauth_client_credentials"
  token_url: "https://auth.example.com/token"
  client_id_env: "CLIENT_ID"
  client_secret_env: "CLIENT_SECRET"
  scope: "read:data"              # Optional
  audience: "https://api.example.com"  # Optional
```

### Agents

Configure LLM agents with provider-specific settings:

**Anthropic (Claude):**
```yaml
agents:
  claude-sonnet:
    provider: "anthropic"
    model: "claude-3-haiku-20240307"
    temperature: 0
    max_tokens: 2048
    system: "You are a helpful assistant."
```

**OpenAI:**
```yaml
agents:
  gpt-4:
    provider: "openai"
    model: "gpt-4o-mini"
    temperature: 0
    max_tokens: 2048
    system: "You are a helpful assistant."
```

**Azure OpenAI:**
```yaml
agents:
  azure-gpt:
    provider: "azure_openai"
    model: "gpt-4o"  # Deployment name
    temperature: 0
    max_tokens: 2048
    system: "You are a helpful assistant."
```

**Required environment variables:**
- Anthropic: `ANTHROPIC_API_KEY`
- OpenAI: `OPENAI_API_KEY`
- Azure: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`

### Scenarios

Define test scenarios with prompts and evaluation criteria:

```yaml
scenarios:
  - id: "search-and-analyze"
    agent: "claude-sonnet"
    servers: ["my-server"]
    prompt: |
      Search for items matching criteria X,
      then analyze the results and provide insights.

    eval:
      # Validate tool usage
      tool_constraints:
        required_tools: ["search", "analyze"]
        forbidden_tools: ["delete"]

      # Validate tool sequence
      tool_sequence:
        allow:
          - ["search", "analyze"]
          - ["search", "search", "analyze"]

      # Validate response content
      response_assertions:
        - type: "regex"
          pattern: "found \\d+ items"
        - type: "jsonpath"
          path: "$.summary.count"
          equals: 10

    # Extract metrics
    extract:
      - name: "item_count"
        from: "final_text"
        regex: "found (?<value>\\d+) items"
```

**Evaluation options:**

- **`tool_constraints`** - Which tools must/must not be used
  - `required_tools`: Tools that must be called
  - `forbidden_tools`: Tools that must not be called

- **`tool_sequence`** - Valid sequences of tool calls
  - `allow`: List of allowed sequences (e.g., `[["search", "analyze"]]`)

- **`response_assertions`** - Validate the final response
  - `regex`: Pattern matching on response text
  - `jsonpath`: Query and validate JSON responses

- **`extract`** - Extract metrics from responses
  - Capture values using regex named groups: `(?<value>...)`

---

## 💡 Usage Examples

### Basic Usage

```bash
# Run all scenarios
mcplab run -c configs/eval.yaml

# Run specific scenario
mcplab run -c configs/eval.yaml -s basic-test

# Run with variance testing (5 iterations)
mcplab run -c configs/eval.yaml -n 5
```

### App Mode

Serve the web app and local API in one process:

```bash
mcplab app --configs-dir configs --runs-dir runs --port 8787 --open
```

Optional development mode (proxy frontend to Vite, keep API local):

```bash
mcplab app --dev
```

### Multi-LLM Testing

Compare how different LLMs perform on the same tasks:

```bash
# Test with multiple agents
mcplab run -c examples/eval.yaml \
  --agents claude-haiku,gpt-4o-mini,gpt-4o

# This runs each scenario with each agent automatically
# 3 scenarios × 3 agents = 9 tests

# Compare results
node scripts/compare-llm-results.mjs runs/LATEST/results.json
```

Output:
```
📊 LLM Performance Comparison

LLM              | Pass Rate | Avg Tools/Run | Avg Duration (ms)
-----------------|-----------|---------------|------------------
claude-haiku     |     100.0% |           2.5 |               850
gpt-4o-mini      |      88.9% |           2.8 |               950
gpt-4o           |      88.9% |           3.2 |              1200

💡 Key Insights
• Highest Pass Rate: claude-haiku (100.0%)
• Fastest: claude-haiku (850ms avg)
• Most Efficient: claude-haiku (2.5 tools/run)
```

### Watch Mode

Auto-rerun tests when config changes:

```bash
mcplab watch -c examples/eval.yaml

# With multi-agent testing
mcplab watch -c examples/eval.yaml \
  --agents claude-haiku,gpt-4o-mini
```

### Generate Reports

```bash
# Regenerate HTML report from previous run
mcplab report --input runs/20260206-212239
```

---

## 📂 Output Structure

Each evaluation run creates a timestamped directory:

```
runs/20260206-212239/
├── trace.jsonl        # Detailed execution log (every tool call, LLM response)
├── results.json       # Structured results (pass/fail, metrics, aggregates)
├── summary.md         # Human-readable summary table
└── report.html        # Interactive HTML report (self-contained)
```

### Trace Format (JSONL)

```jsonl
{"type":"run_started","run_id":"...","ts":"2026-02-06T20:03:54.585Z"}
{"type":"scenario_started","scenario_id":"search-tags","agent":"claude-haiku","ts":"..."}
{"type":"llm_request","messages_summary":"user:Search for tags...","ts":"..."}
{"type":"llm_response","raw_or_summary":"tool_calls:search_tags","ts":"..."}
{"type":"tool_call","server":"demo","tool":"search_tags","args":{...},"ts_start":"..."}
{"type":"tool_result","server":"demo","tool":"search_tags","ok":true,"result_summary":"...","ts_end":"...","duration_ms":1114}
{"type":"final_answer","text":"Found 42 tags matching...","ts":"..."}
{"type":"scenario_finished","scenario_id":"search-tags","pass":true,"metrics":{...},"ts":"..."}
```

### Results Format (JSON)

```json
{
  "metadata": {
    "run_id": "20260206-212239",
    "timestamp": "2026-02-06T20:22:39.000Z",
    "config_hash": "abc123...",
    "git_commit": "def456..."
  },
  "summary": {
    "total_scenarios": 8,
    "total_runs": 8,
    "pass_rate": 1.0,
    "avg_tool_calls_per_run": 2.5,
    "avg_tool_latency_ms": 950
  },
  "scenarios": [...]
}
```

---

## 🎓 Real-World Examples

### Example 1: TrendMiner MCP Server

Test an industrial data analytics MCP server:

```bash
# Run comprehensive test suite (9 scenarios)
mcplab run -c examples/eval-trendminer-comprehensive.yaml

# Test specific batch quality investigation
mcplab run -c examples/eval-trendminer-comprehensive.yaml \
  -s batch-quality-investigation

# Compare Claude vs GPT-4 on all scenarios
mcplab run -c examples/eval-trendminer-simple.yaml \
  --agents claude-haiku,gpt-4o-mini
```

**Included scenarios:**
- Tag search and discovery
- Asset hierarchy navigation
- Data availability checking
- Time-series data retrieval
- Value-based event search
- Batch quality investigation (real-world use case)
- TrendHub session creation

### Example 2: Multi-Agent Comparison

Create `multi-agent-eval.yaml` with one agent defined:

```yaml
agents:
  claude-haiku: {...}
  gpt-4o-mini: {...}
  gpt-4o: {...}

scenarios:
  - id: "complex-task"
    agent: "claude-haiku"  # Default agent
    prompt: "..."
```

Run with all agents:

```bash
mcplab run -c multi-agent-eval.yaml \
  --agents claude-haiku,gpt-4o-mini,gpt-4o \
  -n 5

# 1 scenario × 3 agents × 5 runs = 15 tests
```

### Example 3: CI/CD Integration

Add to `.github/workflows/mcp-eval.yml`:

```yaml
name: MCP Evaluation

on: [push, pull_request]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '22'

      - run: npm install
      - run: npm run build

      - name: Run evaluations
        run: mcplab run -c examples/eval.yaml -n 3
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

      - name: Upload results
        uses: actions/upload-artifact@v2
        with:
          name: evaluation-results
          path: runs/
```

---

## 🛠️ Advanced Features

### Custom Analysis Scripts

Analyze results with custom logic:

```javascript
// my-analysis.mjs
import { readFileSync } from 'fs';

const results = JSON.parse(readFileSync('runs/LATEST/results.json'));

// Calculate custom metrics
for (const scenario of results.scenarios) {
  const efficiency = scenario.pass_rate / scenario.runs[0].tool_call_count;
  console.log(`${scenario.scenario_id}: ${efficiency.toFixed(2)} success/tool`);
}
```

### Generate Multi-LLM Configs

Auto-generate multi-agent configs:

```bash
# Creates eval-trendminer-multi-llm.yaml
node scripts/generate-multi-llm-config.mjs examples/eval-trendminer.yaml
```

### Compare LLM Performance

Built-in comparison script:

```bash
node scripts/compare-llm-results.mjs runs/20260206-212239/results.json
```

Shows:
- Pass rates by LLM
- Tool usage efficiency
- Response times
- Scenario-by-scenario breakdown

---

## 📚 Documentation

- **[Multi-LLM Testing Guide](MULTI-LLM-TESTING.md)** - Comprehensive guide for comparing LLMs
- **[Examples Directory](examples/)** - Sample configurations for various use cases
- **[Scripts Directory](scripts/)** - Utility scripts for analysis and config generation

---

## 🔧 Development

### Project Structure

```
mcp-lab/
├── packages/
│   ├── cli/           # CLI tool (run, watch, report commands)
│   ├── core/          # Evaluation engine, agent adapters, MCP client
│   └── reporting/     # HTML report generation
├── examples/          # Example evaluation configs
├── scripts/           # Utility scripts (multi-LLM, comparison)
├── runs/              # Evaluation results (gitignored)
└── .claude/           # Claude Code skills (optional)
```

### Run in Development Mode

```bash
# Build and watch for changes
npm run build

# Or use tsx for development
npm run dev
```

### Run Tests

```bash
npm test
```

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

Built with:
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk)
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [OpenAI SDK](https://github.com/openai/openai-node)

---

## 📞 Support

- 📖 [Documentation](https://github.com/yourusername/mcp-evaluation)
- 💬 [Discussions](https://github.com/yourusername/mcp-evaluation/discussions)
- 🐛 [Issue Tracker](https://github.com/yourusername/mcp-evaluation/issues)
- 🌐 [MCP Protocol](https://modelcontextprotocol.io)

---

<div align="center">

**⭐ Star this repo if you find it useful!**

Made with ❤️ for the MCP community

</div>
