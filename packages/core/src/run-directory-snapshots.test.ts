import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  listRunDirectories,
  snapshotRunDirectory,
  snapshotsEqual
} from './run-directory-snapshots.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-run-snapshots-'));
  mkdirSync(join(root, 'run-a'), { recursive: true });
  writeFileSync(join(root, 'run-a', 'results.json'), 'one', 'utf8');
  writeFileSync(join(root, 'run-a', 'trace.jsonl'), 'trace', 'utf8');
  return root;
}

describe('run directory snapshots', () => {
  it('discovers directories but not files', () => {
    const root = fixture();
    writeFileSync(join(root, 'not-a-run'), 'file', 'utf8');

    expect(listRunDirectories(root)).toEqual(['run-a']);
    rmSync(root, { recursive: true, force: true });
  });

  it('compares unchanged requested files equal and omits missing files', () => {
    const root = fixture();
    const first = snapshotRunDirectory(root, 'run-a', [
      'results.json',
      'trace.jsonl',
      'summary.md'
    ]);
    const second = snapshotRunDirectory(root, 'run-a', [
      'results.json',
      'trace.jsonl',
      'summary.md'
    ]);

    expect(Object.keys(first?.files ?? {}).sort()).toEqual(['results.json', 'trace.jsonl']);
    expect(first?.files['summary.md']).toBeUndefined();
    expect(snapshotsEqual(first, second)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('detects size and mtime changes', () => {
    const root = fixture();
    const original = snapshotRunDirectory(root, 'run-a', ['results.json']);
    writeFileSync(join(root, 'run-a', 'results.json'), 'changed-content', 'utf8');
    const sizeChanged = snapshotRunDirectory(root, 'run-a', ['results.json']);
    expect(snapshotsEqual(original, sizeChanged)).toBe(false);

    writeFileSync(join(root, 'run-a', 'results.json'), 'one', 'utf8');
    const sameSize = snapshotRunDirectory(root, 'run-a', ['results.json']);
    const oldMtime = sameSize?.files['results.json']?.mtimeMs ?? 0;
    utimesSync(join(root, 'run-a', 'results.json'), new Date(), new Date(oldMtime + 1000));
    const mtimeChanged = snapshotRunDirectory(root, 'run-a', ['results.json']);
    expect(snapshotsEqual(sameSize, mtimeChanged)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('detects added and removed files', () => {
    const root = fixture();
    const original = snapshotRunDirectory(root, 'run-a', ['results.json', 'summary.md']);
    writeFileSync(join(root, 'run-a', 'summary.md'), 'summary', 'utf8');
    const added = snapshotRunDirectory(root, 'run-a', ['results.json', 'summary.md']);
    expect(snapshotsEqual(original, added)).toBe(false);

    rmSync(join(root, 'run-a', 'summary.md'));
    const removed = snapshotRunDirectory(root, 'run-a', ['results.json', 'summary.md']);
    expect(snapshotsEqual(added, removed)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when the run directory disappears', () => {
    const root = fixture();
    rmSync(join(root, 'run-a'), { recursive: true, force: true });

    expect(snapshotRunDirectory(root, 'run-a', ['results.json'])).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  it('detects changes to a non-newest artifact', () => {
    const root = fixture();
    writeFileSync(join(root, 'run-a', 'summary.md'), 'summary', 'utf8');
    const original = snapshotRunDirectory(root, 'run-a', ['results.json', 'summary.md']);
    const resultsPath = join(root, 'run-a', 'results.json');
    const resultsMtime = original?.files['results.json']?.mtimeMs ?? 0;
    const summaryMtime = original?.files['summary.md']?.mtimeMs ?? 0;
    utimesSync(resultsPath, new Date(), new Date(Math.max(1, summaryMtime - 1000)));
    const changed = snapshotRunDirectory(root, 'run-a', ['results.json', 'summary.md']);

    expect(changed?.files['results.json']?.mtimeMs).not.toBe(resultsMtime);
    expect(snapshotsEqual(original, changed)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
