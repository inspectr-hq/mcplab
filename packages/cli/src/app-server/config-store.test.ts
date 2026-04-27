import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { decodeEvalId } from './store-utils.js';
import { listConfigs } from './config-store.js';

function writeConfig(path: string) {
  writeFileSync(path, 'name: test\nagents: []\nscenarios: []\n', 'utf8');
}

describe('listConfigs', () => {
  it('lists yaml files recursively with relativePath and suitePath', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-config-store-'));
    const evalsDir = join(root, 'mcplab', 'evals');
    mkdirSync(join(evalsDir, 'trendminer', 'tags'), { recursive: true });
    writeConfig(join(evalsDir, 'root.yaml'));
    writeConfig(join(evalsDir, 'trendminer', 'tags', 'basic.yaml'));
    writeFileSync(join(evalsDir, 'trendminer', 'tags', 'notes.txt'), 'ignore', 'utf8');

    const records = listConfigs(evalsDir);
    expect(records).toHaveLength(2);

    const byRelative = new Map(records.map((record) => [record.relativePath, record]));
    const rootRecord = byRelative.get('root.yaml');
    const nestedRecord = byRelative.get('trendminer/tags/basic.yaml');
    expect(rootRecord).toBeDefined();
    expect(nestedRecord).toBeDefined();
    expect(rootRecord?.suitePath).toBe('');
    expect(nestedRecord?.suitePath).toBe('trendminer/tags');
    expect(decodeEvalId(nestedRecord!.id, evalsDir)).toBe(
      resolve(join(evalsDir, 'trendminer', 'tags', 'basic.yaml'))
    );
  });
});
