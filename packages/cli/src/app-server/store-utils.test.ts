import { describe, it, expect } from 'vitest';
import { ensureInsideRoot, encodeEvalId, decodeEvalId, safeFileName } from './store-utils.js';
import { resolve } from 'node:path';

const ROOT = '/tmp/testroot';

describe('ensureInsideRoot', () => {
  it('allows a path inside the root and returns it resolved', () => {
    const result = ensureInsideRoot(ROOT, `${ROOT}/subdir/file.yaml`);
    expect(result).toBe(`${ROOT}/subdir/file.yaml`);
  });

  it('allows a path that is exactly the root', () => {
    expect(ensureInsideRoot(ROOT, ROOT)).toBe(ROOT);
  });

  it('throws for a path outside the root', () => {
    expect(() => ensureInsideRoot(ROOT, '/etc/passwd')).toThrow('Path outside allowed root');
  });

  it('throws for a path traversal attempt via ../', () => {
    expect(() => ensureInsideRoot(ROOT, `${ROOT}/../etc/passwd`)).toThrow(
      'Path outside allowed root'
    );
  });

  it('resolves dot-segments and returns a normalised absolute path', () => {
    const result = ensureInsideRoot(ROOT, `${ROOT}/./subdir/../subdir/file.yaml`);
    expect(result).toBe(`${ROOT}/subdir/file.yaml`);
  });
});

describe('encodeEvalId / decodeEvalId', () => {
  it('roundtrips a config path back to the original resolved path', () => {
    const absPath = `${ROOT}/evals/my-config.yaml`;
    const id = encodeEvalId(absPath, ROOT);
    const decoded = decodeEvalId(id, ROOT);
    expect(decoded).toBe(resolve(absPath));
  });

  it('produces a base64url-safe id (no +, /, or = characters)', () => {
    const id = encodeEvalId(`${ROOT}/evals/my config.yaml`, ROOT);
    expect(id).not.toMatch(/[+/=]/);
  });

  it('throws when the decoded path would escape the root', () => {
    const maliciousId = Buffer.from('../../../etc/passwd', 'utf8').toString('base64url');
    expect(() => decodeEvalId(maliciousId, ROOT)).toThrow('Path outside allowed root');
  });
});

describe('safeFileName', () => {
  it('lowercases the input', () => {
    expect(safeFileName('MyConfig')).toBe('myconfig');
  });

  it('replaces spaces with dashes', () => {
    expect(safeFileName('my config')).toBe('my-config');
  });

  it('replaces special characters with dashes', () => {
    expect(safeFileName('hello@world!')).toBe('hello-world');
  });

  it('collapses multiple consecutive dashes into one', () => {
    expect(safeFileName('a--b---c')).toBe('a-b-c');
  });

  it('strips leading and trailing dashes', () => {
    expect(safeFileName('--hello--')).toBe('hello');
  });

  it('preserves underscores', () => {
    expect(safeFileName('my_config_file')).toBe('my_config_file');
  });

  it('replaces dots with dashes', () => {
    expect(safeFileName('config.v2')).toBe('config-v2');
  });

  it('trims surrounding whitespace', () => {
    expect(safeFileName('  hello  ')).toBe('hello');
  });

  it('returns a config-<timestamp> fallback for whitespace-only input', () => {
    expect(safeFileName('   ')).toMatch(/^config-\d+$/);
  });

  it('returns a config-<timestamp> fallback when all characters are stripped', () => {
    expect(safeFileName('@@@')).toMatch(/^config-\d+$/);
  });
});
