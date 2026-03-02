import type { ResultsJson } from '@inspectr/mcplab-core';

const INSPECTR_LOGO_SVG = `<svg width="30" height="30" viewBox="0 0 1648 1648" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="inspectr-report-grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:#7c2d12"></stop><stop offset="100%" style="stop-color:#f97316"></stop></linearGradient></defs><path d="m610 216.654c-66.158 4.092-126.119 35.849-164.917 87.346-8.408 11.16-13.344 19.191-19.983 32.513-12.431 24.946-19.521 50.434-22.11 79.487-1.665 18.687-.854 826.238.841 837.939 7.867 54.284 32.465 101.134 70.706 134.667 16.297 14.291 32.283 24.657 53.963 34.991 16.889 8.05 34.568 13.468 60.5 18.541 9.019 1.764 52.201 1.795 61.5.044 26.487-4.989 43.97-10.341 61-18.675 15.131-7.406 21.53-11.135 60.5-35.267 20.813-12.887 23.095-14.298 29.5-18.24l13-8 13-8c6.901-4.247 12.593-7.767 29.54-18.271 5.796-3.593 12.771-7.863 15.5-9.49 2.728-1.626 8.56-5.19 12.96-7.921 4.4-2.73 72.575-44.711 151.5-93.29s150.925-92.918 160-98.531c9.075-5.612 24.15-14.936 33.5-20.719s23.075-14.234 30.5-18.78c85.169-52.142 120.029-73.942 130.014-81.304 40.974-30.211 68.344-69.764 81.788-118.194 13.864-49.94 8.549-104.847-14.809-153-16.836-34.708-41.252-62.432-74.993-85.154-4.125-2.778-17.625-11.26-30-18.849s-27-16.594-32.5-20.009c-5.5-3.416-109.45-67.427-231-142.246-306.386-188.593-335.221-206.352-350-215.553-30.562-19.028-59.301-29.911-90-34.083-11.697-1.59-30.408-2.514-39.5-1.952m-10.5 77.269c-39.541 6.402-76.013 29.73-97.661 62.467-13.001 19.66-19.718 38.39-22.802 63.584-1.472 12.028-1.434 802.191.04 818.026 1.861 19.998 6.142 35.48 14.415 52.133 17.942 36.114 53.025 64.18 91.508 73.203 3.575.839 8.975 2.118 12 2.844 8.221 1.973 40.343 1.613 49.971-.56 32.301-7.289 65.233-26.686 94.817-55.849 15.26-15.042 22.884-24.803 33.571-42.979 13.939-23.706 20.949-43.36 27.745-77.792 1.004-5.086 1.428-50 1.949-206.5.465-139.686 1.001-201.809 1.777-206 .611-3.3 1.608-9.15 2.217-13 1.672-10.583 4.039-21.117 7.191-32 8.179-28.247 20.714-55.13 37.188-79.751 24.262-36.262 53.189-63.572 93.074-87.872 4.95-3.016 12.825-7.435 17.5-9.82s8.95-4.668 9.5-5.074c3.565-2.63 34.688-13.266 52.465-17.93 6.2-1.627 11.49-3.174 11.754-3.439 1.003-1.002-1.016-2.602-10.967-8.689-5.639-3.449-16.552-10.172-24.252-14.94-13.435-8.319-31.76-19.604-58.5-36.029-6.875-4.222-16.1-9.911-20.5-12.641-7.667-4.758-73.088-45.103-122.5-75.546-75.227-46.348-108.509-66.591-116.5-70.86-9.422-5.033-25.23-10.76-37.043-13.419-7.967-1.794-40.076-2.843-47.957-1.567m473.5 305.564c-5.775.685-11.625 1.491-13 1.792-1.375.3-5.2 1.088-8.5 1.749-7.914 1.587-27.103 7.461-36.5 11.174-38.797 15.33-75.171 44.925-98.829 80.41-11.24 16.86-21.329 38.407-26.167 55.888-2.443 8.825-3.85 14.608-4.866 20-.621 3.3-1.653 8.475-2.292 11.5-.846 4.008-1.345 59.624-1.837 205-.618 182.331-.824 200.361-2.399 209.5-1.629 9.459-4.196 22.506-6.744 34.279-.628 2.903-.881 5.54-.561 5.859.596.596 455.986-279.084 472.195-290.001 17.547-11.819 36.335-33.412 46.291-53.203 3.956-7.863 9.527-23.924 11.597-33.434 4.848-22.272 3.572-48.26-3.506-71.387-6.907-22.572-18.055-40.93-35.316-58.158-12.705-12.681-16.829-15.485-79.066-53.756-7.15-4.397-15.7-9.654-19-11.684-3.3-2.029-8.925-5.504-12.5-7.722-53.826-33.397-67.199-40.611-88.616-47.8-29.343-9.85-61.599-13.421-90.384-10.006m-1066.25 1048.256c3.988.189 10.513.189 14.5 0 3.988-.19.725-.346-7.25-.346s-11.238.156-7.25.346" fill="url(#inspectr-report-grad)" fill-rule="evenodd"></path></svg>`;

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
          return `<tr><td><code class="sequence-code">${escapeHtml(seq)}</code></td><td class="count-col">${count}</td></tr>`;
        })
        .join('\n');

      const allowedSequences = scenario.eval?.tool_sequence?.allow ?? [];
      const allowedRows = allowedSequences
        .map(
          (seq) =>
            `<tr><td><code class="sequence-code">${escapeHtml(JSON.stringify(seq))}</code></td></tr>`
        )
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
          <p><strong>Agent:</strong> ${escapeHtml(scenario.agent)} | <strong>Runs:</strong> ${
        scenario.runs.length
      } | <strong>Pass rate:</strong> ${formatPercent(scenario.pass_rate)}</p>

          <h4>Distinct tool sequences</h4>
          <table>
            <thead><tr><th>Sequence</th><th class="count-col">Count</th></tr></thead>
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
  <title>MCPLab Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7fb;
      --card: #ffffff;
      --text: #1b1f29;
      --muted: #5d6472;
      --accent: #f97316;
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
      padding: 28px 0;
      background: radial-gradient(circle at top left, #dfe7ff, var(--bg));
      border-bottom: 1px solid #e0e4ef;
      margin-bottom: 12px;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 32px;
      box-sizing: border-box;
    }
    .header-inner {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .header-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .header-title h1 {
      margin: 0;
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
      padding: 24px 0 48px;
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
      overflow-wrap: anywhere;
      word-break: break-word;
      vertical-align: top;
    }
    th {
      background: #f0f3fb;
      color: var(--muted);
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      font-size: 12px;
      white-space: nowrap;
      overflow-wrap: normal;
      word-break: normal;
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
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      display: inline-block;
      max-width: 100%;
      box-sizing: border-box;
    }
    .sequence-code {
      font-size: 12px;
      line-height: 1.4;
    }
    .count-col {
      width: 88px;
      min-width: 88px;
      max-width: 88px;
      white-space: nowrap;
      text-align: right;
    }
  </style>
</head>
<body>
  <header>
    <div class="container header-inner">
      <div>
        <div class="header-title">
          ${INSPECTR_LOGO_SVG}
          <h1>MCPLab Report</h1>
        </div>
        <div class="meta">
          Run ID: ${escapeHtml(results.metadata.run_id)}<br />
          Timestamp: ${escapeHtml(results.metadata.timestamp)}<br />
          Config hash: ${escapeHtml(results.metadata.config_hash)}<br />
          CLI version: ${escapeHtml(results.metadata.cli_version)}
          ${
            results.metadata.git_commit
              ? `<br />Git commit: ${escapeHtml(results.metadata.git_commit)}`
              : ''
          }
        </div>
      </div>
    </div>
  </header>

  <main class="container">
    <section class="tiles">
      <div class="tile"><strong>Total scenarios</strong><div>${
        results.summary.total_scenarios
      }</div></div>
      <div class="tile"><strong>Total runs</strong><div>${results.summary.total_runs}</div></div>
      <div class="tile"><strong>Pass rate</strong><div>${formatPercent(
        results.summary.pass_rate
      )}</div></div>
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
