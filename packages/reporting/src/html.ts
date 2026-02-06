import type { ResultsJson } from '@mcp-eval/core';

function escapeHtml(value: string | number | boolean | null | undefined): string {
  // Convert value to string first
  const str = value == null ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderHtml(results: ResultsJson): string {
  const scenarioRows = results.scenarios
    .map((scenario) => {
      const toolCalls = scenario.runs.reduce((sum, run) => sum + run.tool_call_count, 0);
      const passRate = formatPercent(scenario.pass_rate);
      const sequences = Object.keys(scenario.distinct_sequences).length;
      const status =
        scenario.pass_rate === 1 ? 'pass' : scenario.pass_rate === 0 ? 'fail' : 'mixed';
      return `
        <tr data-status="${status}">
          <td><a href="#scenario-${escapeHtml(scenario.scenario_id)}">${escapeHtml(
            scenario.scenario_id
          )}</a></td>
          <td>${escapeHtml(scenario.agent)}</td>
          <td>${scenario.runs.length}</td>
          <td>${passRate}</td>
          <td>${toolCalls}</td>
          <td>${sequences}</td>
        </tr>
      `;
    })
    .join('\n');

  const details = results.scenarios
    .map((scenario) => {
      const sequenceRows = Object.entries(scenario.distinct_sequences)
        .map(([seq, count]) => {
          return `<tr><td><code>${escapeHtml(seq)}</code></td><td>${count}</td></tr>`;
        })
        .join('\n');

      const allowedSequences = scenario.eval?.tool_sequence?.allow ?? [];
      const allowedRows = allowedSequences
        .map((seq) => `<tr><td><code>${escapeHtml(JSON.stringify(seq))}</code></td></tr>`)
        .join('\n');

      const requiredTools = scenario.eval?.tool_constraints?.required_tools ?? [];
      const forbiddenTools = scenario.eval?.tool_constraints?.forbidden_tools ?? [];
      const requiredStats = scenario.tool_constraints_stats?.required ?? {};
      const forbiddenStats = scenario.tool_constraints_stats?.forbidden ?? {};

      const requiredRows = requiredTools
        .map((tool) => {
          const count = requiredStats[tool] ?? 0;
          return `<tr><td>${escapeHtml(tool)}</td><td>${count}/${scenario.runs.length}</td></tr>`;
        })
        .join('\n');

      const forbiddenRows = forbiddenTools
        .map((tool) => {
          const count = forbiddenStats[tool] ?? 0;
          return `<tr><td>${escapeHtml(tool)}</td><td>${count}/${scenario.runs.length}</td></tr>`;
        })
        .join('\n');

      const toolRows = Object.entries(scenario.tool_usage_frequency)
        .map(([tool, count]) => `<tr><td>${escapeHtml(tool)}</td><td>${count}</td></tr>`)
        .join('\n');

      const extractSections = Object.entries(scenario.extracted_values)
        .map(([name, values]) => {
          const rows = Object.entries(values)
            .map(([value, count]) => `<tr><td>${escapeHtml(value)}</td><td>${count}</td></tr>`)
            .join('\n');
          return `
            <h4>${escapeHtml(name)}</h4>
            <table>
              <thead><tr><th>Value</th><th>Count</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="2">No values</td></tr>'}</tbody>
            </table>
          `;
        })
        .join('\n');

      return `
        <section id="scenario-${escapeHtml(scenario.scenario_id)}" class="scenario">
          <h3>${escapeHtml(scenario.scenario_id)}</h3>
          <p><strong>Agent:</strong> ${escapeHtml(scenario.agent)} | <strong>Runs:</strong> ${scenario.runs.length} | <strong>Pass rate:</strong> ${formatPercent(
            scenario.pass_rate
          )}</p>

          <h4>Distinct tool sequences</h4>
          <table>
            <thead><tr><th>Sequence</th><th>Count</th></tr></thead>
            <tbody>${sequenceRows || '<tr><td colspan="2">No tool calls</td></tr>'}</tbody>
          </table>

          <h4>Allowed sequences</h4>
          <table>
            <thead><tr><th>Sequence</th></tr></thead>
            <tbody>${allowedRows || '<tr><td>No constraints</td></tr>'}</tbody>
          </table>

          <h4>Required tools</h4>
          <table>
            <thead><tr><th>Tool</th><th>Used (runs)</th></tr></thead>
            <tbody>${requiredRows || '<tr><td colspan="2">No required tools</td></tr>'}</tbody>
          </table>

          <h4>Forbidden tools</h4>
          <table>
            <thead><tr><th>Tool</th><th>Used (runs)</th></tr></thead>
            <tbody>${forbiddenRows || '<tr><td colspan="2">No forbidden tools</td></tr>'}</tbody>
          </table>

          <h4>Tool usage</h4>
          <table>
            <thead><tr><th>Tool</th><th>Count</th></tr></thead>
            <tbody>${toolRows || '<tr><td colspan="2">No tool calls</td></tr>'}</tbody>
          </table>

          ${extractSections ? `<h4>Extracted values</h4>${extractSections}` : ''}

          <details>
            <summary>Last final answer</summary>
            <pre>${escapeHtml(scenario.last_final_answer || '')}</pre>
          </details>
        </section>
      `;
    })
    .join('\n');

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>mcp-eval report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7fb;
      --card: #ffffff;
      --text: #1b1f29;
      --muted: #5d6472;
      --accent: #2f5fdd;
      --pass: #1f7a3a;
      --fail: #bb1f1f;
      --mixed: #c77d19;
    }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Space Grotesk", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      padding: 32px;
      background: radial-gradient(circle at top left, #dfe7ff, var(--bg));
      border-bottom: 1px solid #e0e4ef;
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 28px;
    }
    .meta {
      color: var(--muted);
      font-size: 14px;
    }
    main {
      padding: 24px 32px 48px;
      max-width: 1100px;
      margin: 0 auto;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .tile {
      background: var(--card);
      padding: 16px;
      border-radius: 12px;
      box-shadow: 0 8px 20px rgba(20, 24, 35, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--card);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 20px rgba(20, 24, 35, 0.05);
      margin-bottom: 24px;
    }
    th, td {
      padding: 12px 14px;
      text-align: left;
      border-bottom: 1px solid #edf0f6;
      font-size: 14px;
    }
    th {
      background: #f0f3fb;
      color: var(--muted);
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      font-size: 12px;
    }
    tr:last-child td {
      border-bottom: none;
    }
    .controls {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .controls button {
      border: none;
      border-radius: 999px;
      padding: 8px 14px;
      cursor: pointer;
      background: #e4e9f8;
    }
    .controls button.active {
      background: var(--accent);
      color: white;
    }
    .scenario {
      background: var(--card);
      padding: 16px 20px;
      border-radius: 14px;
      margin-bottom: 20px;
      box-shadow: 0 8px 20px rgba(20, 24, 35, 0.05);
    }
    pre {
      white-space: pre-wrap;
    }
    code {
      background: #eef1f7;
      padding: 2px 6px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <header>
    <h1>mcp-eval report</h1>
    <div class="meta">
      Run ID: ${escapeHtml(results.metadata.run_id)}<br />
      Timestamp: ${escapeHtml(results.metadata.timestamp)}<br />
      Config hash: ${escapeHtml(results.metadata.config_hash)}<br />
      CLI version: ${escapeHtml(results.metadata.cli_version)}
      ${results.metadata.git_commit ? `<br />Git commit: ${escapeHtml(results.metadata.git_commit)}` : ''}
    </div>
  </header>

  <main>
    <section class="tiles">
      <div class="tile"><strong>Total scenarios</strong><div>${results.summary.total_scenarios}</div></div>
      <div class="tile"><strong>Total runs</strong><div>${results.summary.total_runs}</div></div>
      <div class="tile"><strong>Pass rate</strong><div>${formatPercent(results.summary.pass_rate)}</div></div>
      <div class="tile"><strong>Avg tool calls/run</strong><div>${results.summary.avg_tool_calls_per_run.toFixed(
        2
      )}</div></div>
      <div class="tile"><strong>Avg tool latency</strong><div>${
        results.summary.avg_tool_latency_ms === null
          ? 'n/a'
          : `${results.summary.avg_tool_latency_ms.toFixed(1)} ms`
      }</div></div>
    </section>

    <section>
      <h2>Scenarios</h2>
      <div class="controls">
        <button class="active" data-filter="all">All</button>
        <button data-filter="pass">Pass</button>
        <button data-filter="fail">Fail</button>
        <button data-filter="mixed">Mixed</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Agent</th>
            <th>Runs</th>
            <th>Pass rate</th>
            <th>Tool calls</th>
            <th>Distinct sequences</th>
          </tr>
        </thead>
        <tbody>
          ${scenarioRows}
        </tbody>
      </table>
    </section>

    <section>
      <h2>Scenario details</h2>
      ${details}
    </section>

    <section>
      <h2>Trace files</h2>
      <ul>
        <li><a href="trace.jsonl">trace.jsonl</a></li>
        <li><a href="results.json">results.json</a></li>
      </ul>
    </section>
  </main>

  <script>
    const buttons = document.querySelectorAll('.controls button');
    const rows = document.querySelectorAll('table tbody tr');

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.getAttribute('data-filter');
        rows.forEach(row => {
          const status = row.getAttribute('data-status');
          if (filter === 'all' || status === filter) {
            row.style.display = '';
          } else {
            row.style.display = 'none';
          }
        });
      });
    });
  </script>
</body>
</html>
  `.trim();
}
