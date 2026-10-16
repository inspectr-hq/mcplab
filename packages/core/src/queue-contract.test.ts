import { describe, expect, it } from 'vitest';
import { ROVER_CAPABILITIES, ROVER_PROTOCOL_VERSION } from './queue-contract.js';

describe('Rover protocol contract', () => {
  it('defines the mandatory protocol version and capabilities centrally', () => {
    expect(ROVER_PROTOCOL_VERSION).toBe(2);
    expect(ROVER_CAPABILITIES).toEqual(['scenario_control', 'assignment_lease']);
  });
});
