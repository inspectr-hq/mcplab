import { DEFAULT_AGENT_TEMPERATURE } from './agent-temperature';
import type { AgentConfig } from '@/types/eval';

export function createEmptyAgent(type: 'llm' | 'browser' = 'llm'): AgentConfig {
  if (type === 'browser') {
    return {
      id: `agt-${Date.now()}`,
      name: '',
      type: 'browser',
      provider: 'claude',
      model: '',
      maxTokens: 0,
      url: '',
      newConversationBetweenScenarios: true
    };
  }
  return {
    id: `agt-${Date.now()}`,
    name: '',
    type: 'llm',
    provider: 'openai',
    model: 'gpt-4o',
    temperature: DEFAULT_AGENT_TEMPERATURE,
    maxTokens: 4096
  };
}
