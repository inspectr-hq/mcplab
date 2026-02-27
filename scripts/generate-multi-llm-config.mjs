#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { parse, stringify } from 'yaml';

/**
 * Generate a multi-LLM evaluation config from a base config.
 *
 * Usage:
 *   node scripts/generate-multi-llm-config.mjs examples/eval-trendminer.yaml
 *
 * This will create examples/eval-trendminer-multi-llm.yaml with scenarios
 * duplicated for each LLM agent.
 */

const llmAgents = [
  {
    name: 'claude-haiku',
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    description: 'Fast, cost-effective'
  },
  {
    name: 'gpt-4o-mini',
    provider: 'openai',
    model: 'gpt-4o-mini',
    description: 'Balanced performance'
  },
  {
    name: 'gpt-4o',
    provider: 'openai',
    model: 'gpt-4o',
    description: 'High capability'
  }
];

const baseConfigPath = process.argv[2];
if (!baseConfigPath) {
  console.error('Usage: node generate-multi-llm-config.mjs <config.yaml>');
  process.exit(1);
}

const baseConfig = parse(readFileSync(baseConfigPath, 'utf8'));
const outputPath = baseConfigPath.replace('.yaml', '-multi-llm.yaml');

// Create agents for each LLM
const agents = {};
for (const llm of llmAgents) {
  agents[llm.name] = {
    provider: llm.provider,
    model: llm.model,
    temperature: 0,
    max_tokens: 2048,
    system: baseConfig.agents[Object.keys(baseConfig.agents)[0]]?.system ||
            "You are an evaluation agent."
  };
}

// Duplicate scenarios for each LLM
const scenarios = [];
for (const scenario of baseConfig.scenarios) {
  for (const llm of llmAgents) {
    scenarios.push({
      ...scenario,
      id: `${scenario.id}-${llm.name}`,
      agent: llm.name
    });
  }
}

const multiLlmConfig = {
  servers: baseConfig.servers,
  agents,
  scenarios
};

writeFileSync(outputPath, stringify(multiLlmConfig), 'utf8');
console.log(`✅ Generated multi-LLM config: ${outputPath}`);
console.log(`   ${llmAgents.length} agents × ${baseConfig.scenarios.length} scenarios = ${scenarios.length} total tests`);
