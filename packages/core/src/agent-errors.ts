import type { AgentConnectionFailure } from './types.js';

export class AgentConnectionError extends Error {
  constructor(
    readonly failure: AgentConnectionFailure,
    message: string
  ) {
    super(message);
    this.name = 'AgentConnectionError';
  }
}
