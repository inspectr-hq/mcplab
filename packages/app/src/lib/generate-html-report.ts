import type { EvalResult } from '@/types/eval';

export function generateHtmlReport(result: EvalResult): string {
  const passCount = result.scenarios.reduce(
    (s, sc) => s + sc.runs.filter((r) => r.passed).length,
    0
  );
  const failCount = result.totalRuns - passCount;

  const toolFreq: Record<string, number> = {};
  result.scenarios.forEach((sc) =>
    sc.runs.forEach((r) =>
      r.toolCalls.forEach((tc) => {
        toolFreq[tc.name] = (toolFreq[tc.name] || 0) + 1;
      })
    )
  );
  const toolLabels = Object.keys(toolFreq);
  const toolCounts = Object.values(toolFreq);

  const scenarioRows = result.scenarios
    .map(
      (sc) => `
    <div class="scenario-card">
      <div class="scenario-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="chevron">▶</span>
        <span class="scenario-name">${esc(sc.scenarioName)}</span>
        <span class="scenario-agent">${esc(sc.agentName)}</span>
        <span class="mono">${sc.runs.length} runs</span>
        <span class="badge ${sc.passRate >= 0.8 ? 'badge-pass' : sc.passRate >= 0.5 ? 'badge-warn' : 'badge-fail'}">${Math.round(sc.passRate * 100)}%</span>
        <span class="mono">${sc.avgToolCalls.toFixed(1)} avg tools</span>
      </div>
      <div class="scenario-detail">
        ${sc.runs
          .map(
            (run) => `
          <div class="run-row">
            <span class="run-status ${run.passed ? 'pass' : 'fail'}">${run.passed ? '✓' : '✗'}</span>
            <span class="mono run-label">Run #${run.runIndex + 1}</span>
            <span class="mono run-duration">${run.duration}ms</span>
            <div class="tool-pills">
              ${run.toolCalls.map((tc) => `<span class="pill">${esc(tc.name)} <small>${tc.duration}ms</small></span>`).join('')}
            </div>
            ${run.failureReasons.length ? `<div class="failure-reasons">${run.failureReasons.map((r) => esc(r)).join(', ')}</div>` : ''}
          </div>`
          )
          .join('')}
      </div>
    </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MCPLab Report — ${esc(result.id)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#1f2937;padding:2rem;max-width:1100px;margin:0 auto}
h1{font-size:1.5rem;font-weight:700}
.mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.8rem}
.header{display:flex;align-items:center;gap:1rem;margin-bottom:.25rem}
.sub{font-size:.75rem;color:#6b7280;margin-bottom:1.5rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-bottom:2rem}
.stat{background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;padding:1rem}
.stat-label{font-size:.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
.stat-value{font-size:1.5rem;font-weight:700;margin-top:.25rem}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem}
.chart-card{background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;padding:1rem}
.chart-card h3{font-size:.85rem;font-weight:600;margin-bottom:.75rem}
canvas{max-height:220px}
.scenario-card{background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;margin-bottom:.75rem;overflow:hidden}
.scenario-header{display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;cursor:pointer;font-size:.85rem}
.scenario-header:hover{background:#f9fafb}
.chevron{font-size:.6rem;transition:transform .15s;color:#9ca3af}
.scenario-card.open .chevron{transform:rotate(90deg)}
.scenario-name{font-weight:600;flex:1}
.scenario-agent{color:#6b7280;font-size:.8rem}
.scenario-detail{display:none;border-top:1px solid #e5e7eb;padding:.75rem 1rem;background:#fafafa}
.scenario-card.open .scenario-detail{display:block}
.run-row{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;padding:.5rem 0;border-bottom:1px solid #f3f4f6;font-size:.8rem}
.run-row:last-child{border-bottom:none}
.run-status{font-weight:700;font-size:1rem}
.run-status.pass{color:#059669}
.run-status.fail{color:#dc2626}
.run-duration{color:#6b7280}
.tool-pills{display:flex;flex-wrap:wrap;gap:.25rem}
.pill{background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:9999px;font-size:.7rem;font-family:'JetBrains Mono',monospace}
.pill small{color:#b45309;margin-left:2px}
.failure-reasons{width:100%;color:#dc2626;font-size:.75rem;margin-top:.25rem}
.badge{padding:2px 10px;border-radius:9999px;font-size:.75rem;font-weight:600}
.badge-pass{background:#d1fae5;color:#065f46}
.badge-warn{background:#fef3c7;color:#92400e}
.badge-fail{background:#fee2e2;color:#991b1b}
.footer{text-align:center;color:#9ca3af;font-size:.7rem;margin-top:2rem;padding-top:1rem;border-top:1px solid #e5e7eb}
</style>
</head>
<body>
<div class="header">
  <h1 class="mono">${esc(result.id)}</h1>
  <span class="badge ${result.overallPassRate >= 0.8 ? 'badge-pass' : result.overallPassRate >= 0.5 ? 'badge-warn' : 'badge-fail'}">${Math.round(result.overallPassRate * 100)}% pass</span>
</div>
<p class="sub">${new Date(result.timestamp).toLocaleString()} · Config hash: <span class="mono">${esc(result.configHash)}</span></p>

<div class="stats">
  <div class="stat"><div class="stat-label">Scenarios</div><div class="stat-value">${result.totalScenarios}</div></div>
  <div class="stat"><div class="stat-label">Total Runs</div><div class="stat-value">${result.totalRuns}</div></div>
  <div class="stat"><div class="stat-label">Pass Rate</div><div class="stat-value">${Math.round(result.overallPassRate * 100)}%</div></div>
  <div class="stat"><div class="stat-label">Avg Tool Calls</div><div class="stat-value">${result.avgToolCalls.toFixed(1)}</div></div>
  <div class="stat"><div class="stat-label">Avg Latency</div><div class="stat-value">${result.avgLatency}ms</div></div>
</div>

<div class="charts">
  <div class="chart-card"><h3>Pass / Fail</h3><canvas id="pieChart"></canvas></div>
  <div class="chart-card"><h3>Tool Usage</h3><canvas id="barChart"></canvas></div>
</div>

<h2 style="font-size:1rem;font-weight:600;margin-bottom:.75rem">Scenarios</h2>
${scenarioRows}

<div class="footer">Generated by MCPLab · ${new Date().toISOString()}</div>

<script>
new Chart(document.getElementById('pieChart'),{type:'doughnut',data:{labels:['Pass','Fail'],datasets:[{data:[${passCount},${failCount}],backgroundColor:['#059669','#dc2626'],borderWidth:0}]},options:{cutout:'60%',plugins:{legend:{position:'bottom',labels:{font:{size:11}}}}}});
new Chart(document.getElementById('barChart'),{type:'bar',data:{labels:${JSON.stringify(toolLabels)},datasets:[{data:${JSON.stringify(toolCounts)},backgroundColor:'#f59e0b',borderRadius:4}]},options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{display:false}},y:{grid:{display:false},ticks:{font:{family:'monospace',size:11}}}}}});
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
