import { describe, expect, it } from 'vitest';
import { validateRoverRegistration } from './rover-connection.js';

const valid = {
  type: 'register',
  protocolVersion: 2,
  provider: 'claude',
  pageUrl: 'https://claude.ai/chat/1',
  extensionVersion: '1.0.0',
  capabilities: ['scenario_control', 'assignment_lease']
};

describe('Rover registration validation', () => {
  it('accepts a protocol v2 lease-capable registration', () => {
    expect(validateRoverRegistration(valid)).toBeNull();
  });

  it('rejects an old protocol version', () => {
    expect(validateRoverRegistration({ ...valid, protocolVersion: 1 })).toBe('Rover registration required');
  });

  it('rejects registrations without assignment leases', () => {
    expect(validateRoverRegistration({ ...valid, capabilities: ['scenario_control'] })).toBe('Rover assignment leases are required');
  });
});
