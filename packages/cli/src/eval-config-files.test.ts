import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  deriveConfigRelativePath,
  deriveSuitePathFromRelativePath,
  listYamlConfigFilesRecursive,
  resolveRunConfigPaths
} from './eval-config-files.js';

function createTempTree(): { root: string; paths: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-evals-'));
  mkdirSync(join(root, 'trendminer', 'tags'), { recursive: true });
  mkdirSync(join(root, 'trendminer', 'alerts'), { recursive: true });
  writeFileSync(join(root, 'root.yaml'), 'name: root\nagents: []\nscenarios: []\n', 'utf8');
  writeFileSync(
    join(root, 'trendminer', 'tags', 'alpha.yaml'),
    'name: alpha\nagents: []\nscenarios: []\n',
    'utf8'
  );
  writeFileSync(
    join(root, 'trendminer', 'alerts', 'beta.yml'),
    'name: beta\nagents: []\nscenarios: []\n',
    'utf8'
  );
  writeFileSync(join(root, 'trendminer', 'notes.txt'), 'ignore\n', 'utf8');
  return {
    root,
    paths: {
      rootYaml: join(root, 'root.yaml'),
      alpha: join(root, 'trendminer', 'tags', 'alpha.yaml'),
      beta: join(root, 'trendminer', 'alerts', 'beta.yml')
    }
  };
}

describe('listYamlConfigFilesRecursive', () => {
  it('finds yaml files recursively in deterministic relative-path order', () => {
    const { root, paths } = createTempTree();
    expect(listYamlConfigFilesRecursive(root)).toEqual([paths.rootYaml, paths.beta, paths.alpha]);
  });

  it('returns empty for missing directory', () => {
    expect(listYamlConfigFilesRecursive('/tmp/does-not-exist-123456')).toEqual([]);
  });
});

describe('resolveRunConfigPaths', () => {
  it('returns single item when config path points to a file', () => {
    const { root, paths } = createTempTree();
    expect(resolveRunConfigPaths(paths.alpha, root)).toEqual([paths.alpha]);
  });

  it('returns all yaml files recursively when config path points to a directory', () => {
    const { root, paths } = createTempTree();
    expect(resolveRunConfigPaths('.', root)).toEqual([paths.rootYaml, paths.beta, paths.alpha]);
  });

  it('throws when directory has no yaml files', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-empty-'));
    mkdirSync(join(root, 'empty'), { recursive: true });
    writeFileSync(join(root, 'empty', 'a.txt'), 'x', 'utf8');
    expect(() => resolveRunConfigPaths('empty', root)).toThrow(
      'No .yaml/.yml files found under config directory'
    );
  });
});

describe('suite derivation helpers', () => {
  it('derives relative and suite paths', () => {
    const { root, paths } = createTempTree();
    expect(deriveConfigRelativePath(paths.alpha, root)).toBe('trendminer/tags/alpha.yaml');
    expect(deriveSuitePathFromRelativePath('trendminer/tags/alpha.yaml')).toBe('trendminer/tags');
    expect(deriveSuitePathFromRelativePath('root.yaml')).toBe('');
  });
});
