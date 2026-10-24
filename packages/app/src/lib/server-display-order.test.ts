import { describe, expect, it } from 'vitest';
import { sortServersForDisplay } from './server-display-order';

describe('sortServersForDisplay', () => {
  it('sorts by visible name case-insensitively and uses the id as a tie-breaker', () => {
    const servers = [
      { id: 'zulu', name: 'weather MCP' },
      { id: 'beta', name: 'Bookings' },
      { id: 'alpha', name: 'bookings' },
      { id: 'fallback', name: '' }
    ];

    expect(sortServersForDisplay(servers).map((server) => server.id)).toEqual([
      'alpha',
      'beta',
      'fallback',
      'zulu'
    ]);
  });
});
