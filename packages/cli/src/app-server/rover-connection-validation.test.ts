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
    expect(validateRoverRegistration(valid)).toEqual({ ok: true });
  });

  it('rejects an old protocol version', () => {
    expect(validateRoverRegistration({ ...valid, protocolVersion: 1 })).toEqual({
      ok: false,
      code: 'invalid_registration',
      message: 'Rover registration required'
    });
  });

  it('rejects registrations missing required metadata', () => {
    expect(validateRoverRegistration({ ...valid, provider: undefined })).toMatchObject({
      code: 'invalid_registration'
    });
    expect(validateRoverRegistration({ ...valid, pageUrl: undefined })).toMatchObject({
      code: 'invalid_registration'
    });
    expect(validateRoverRegistration({ ...valid, extensionVersion: undefined })).toMatchObject({
      code: 'invalid_registration'
    });
  });

  it('rejects registrations without assignment leases', () => {
    expect(
      validateRoverRegistration({ ...valid, capabilities: ['scenario_control'] })
    ).toMatchObject({ code: 'lease_required' });
    expect(validateRoverRegistration({ ...valid, capabilities: 'assignment_lease' })).toMatchObject(
      { code: 'lease_required' }
    );
  });
});
