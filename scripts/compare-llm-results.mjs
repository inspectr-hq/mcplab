#!/usr/bin/env node
import { readFileSync } from 'fs';

/**
 * Compare LLM performance across evaluation results.
 *
 * Usage:
 *   node scripts/compare-llm-results.mjs runs/20260206-212239/results.json
 *
 * Analyzes:
 * - Pass rates by LLM
 * - Tool usage patterns
 * - Response times
 * - Tool call efficiency
 */

const resultsPath = process.argv[2];
if (!resultsPath) {
  console.error('Usage: node compare-llm-results.mjs <results.json>');
  process.exit(1);
}

const results = JSON.parse(readFileSync(resultsPath, 'utf8'));

// Group scenarios by base ID (removing LLM suffix)
const byLLM = {};
for (const scenario of results.scenarios) {
  // Extract LLM name from scenario ID (e.g., "search-tags-haiku" -> "haiku")
  const match = scenario.scenario_id.match(/-(claude-haiku|gpt-4o-mini|gpt-4o|azure-gpt-4o)$/);
  const llm = match ? match[1] : 'unknown';
  const baseId = match ? scenario.scenario_id.replace(`-${llm}`, '') : scenario.scenario_id;

  if (!byLLM[llm]) {
    byLLM[llm] = {
      scenarios: [],
      totalRuns: 0,
      passedRuns: 0,
      totalToolCalls: 0,
      totalDuration: 0
    };
  }

  byLLM[llm].scenarios.push({ baseId, ...scenario });
  byLLM[llm].totalRuns += scenario.runs.length;
  byLLM[llm].passedRuns += scenario.runs.filter(r => r.pass).length;
  byLLM[llm].totalToolCalls += scenario.runs.reduce((sum, r) => sum + r.tool_call_count, 0);
  byLLM[llm].totalDuration += scenario.runs.reduce((sum, r) =>
    sum + r.tool_durations_ms.reduce((s, d) => s + d, 0), 0
  );
}

// Print comparison table
console.log('\n📊 LLM Performance Comparison\n');
console.log('LLM              | Pass Rate | Avg Tools/Run | Avg Duration (ms) | Total Scenarios');
console.log('-----------------|-----------|---------------|-------------------|----------------');

for (const [llm, stats] of Object.entries(byLLM).sort()) {
  const passRate = (stats.passedRuns / stats.totalRuns * 100).toFixed(1);
  const avgTools = (stats.totalToolCalls / stats.totalRuns).toFixed(1);
  const avgDuration = Math.round(stats.totalDuration / stats.totalRuns);

  console.log(
    `${llm.padEnd(16)} | ` +
    `${passRate.padStart(8)}% | ` +
    `${avgTools.padStart(13)} | ` +
    `${avgDuration.toString().padStart(17)} | ` +
    `${stats.scenarios.length.toString().padStart(15)}`
  );
}

// Detailed comparison by scenario
console.log('\n📋 Scenario-by-Scenario Comparison\n');

// Get unique base IDs
const baseIds = new Set();
for (const llm of Object.keys(byLLM)) {
  for (const scenario of byLLM[llm].scenarios) {
    baseIds.add(scenario.baseId);
  }
}

for (const baseId of Array.from(baseIds).sort()) {
  console.log(`\n🔍 ${baseId}`);
  console.log('   LLM              | Pass | Tool Calls | Tools Used');
  console.log('   -----------------|------|------------|------------------');

  for (const llm of Object.keys(byLLM).sort()) {
    const scenario = byLLM[llm].scenarios.find(s => s.baseId === baseId);
    if (scenario) {
      const pass = scenario.pass_rate === 1 ? '✅' : '❌';
      const toolCalls = scenario.runs[0]?.tool_call_count || 0;
      const tools = Object.keys(scenario.tool_usage_frequency).join(', ');

      console.log(
        `   ${llm.padEnd(16)} | ${pass}   | ` +
        `${toolCalls.toString().padStart(10)} | ${tools}`
      );
    }
  }
}

// Summary insights
console.log('\n💡 Key Insights\n');

const llmList = Object.keys(byLLM).sort();
if (llmList.length > 1) {
  const best = llmList.reduce((a, b) =>
    byLLM[a].passedRuns / byLLM[a].totalRuns > byLLM[b].passedRuns / byLLM[b].totalRuns ? a : b
  );
  const fastest = llmList.reduce((a, b) =>
    byLLM[a].totalDuration / byLLM[a].totalRuns < byLLM[b].totalDuration / byLLM[b].totalRuns ? a : b
  );
  const mostEfficient = llmList.reduce((a, b) =>
    byLLM[a].totalToolCalls / byLLM[a].totalRuns < byLLM[b].totalToolCalls / byLLM[b].totalRuns ? a : b
  );

  console.log(`• Highest Pass Rate: ${best} (${(byLLM[best].passedRuns / byLLM[best].totalRuns * 100).toFixed(1)}%)`);
  console.log(`• Fastest: ${fastest} (${Math.round(byLLM[fastest].totalDuration / byLLM[fastest].totalRuns)}ms avg)`);
  console.log(`• Most Efficient: ${mostEfficient} (${(byLLM[mostEfficient].totalToolCalls / byLLM[mostEfficient].totalRuns).toFixed(1)} tools/run)`);
}

console.log('');
