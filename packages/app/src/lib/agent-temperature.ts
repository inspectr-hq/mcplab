export const DEFAULT_AGENT_TEMPERATURE = 0;

export function resolveAgentTemperature(temperature: number | undefined): number {
  return temperature ?? DEFAULT_AGENT_TEMPERATURE;
}
