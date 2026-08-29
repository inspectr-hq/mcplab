import { describe, expect, it } from 'vitest';
import kleur from 'kleur';
import {
  CLI_BANNER,
  formatCliBanner,
  formatCliStartupLine,
  formatLangSmithStatus
} from './cli-branding.js';

describe('CLI branding', () => {
  it('provides a compact ASCII MCPLAB banner', () => {
    expect(CLI_BANNER.split('\n')).toHaveLength(6);
    expect(CLI_BANNER).toContain('|  \\/  |');
    expect(CLI_BANNER).toContain('/ ___|');
    expect(CLI_BANNER).not.toMatch(/\x1b\[/);
  });

  it('uses the MCPLab orange truecolor when terminal colors are enabled', () => {
    const previousEnabled = kleur.enabled;
    const previousColorTerm = process.env.COLORTERM;
    kleur.enabled = true;
    process.env.COLORTERM = 'truecolor';

    try {
      expect(formatCliBanner()).toContain('\x1b[38;2;249;115;22m');
      expect(formatCliBanner()).toContain('\x1b[39m');
    } finally {
      kleur.enabled = previousEnabled;
      process.env.COLORTERM = previousColorTerm;
    }
  });

  it('falls back to 256-color orange when truecolor is unavailable', () => {
    const previousEnabled = kleur.enabled;
    const previousColorTerm = process.env.COLORTERM;
    kleur.enabled = true;
    delete process.env.COLORTERM;

    try {
      expect(formatCliBanner()).toContain('\x1b[38;5;208m');
      expect(formatCliBanner()).toContain('\x1b[39m');
    } finally {
      kleur.enabled = previousEnabled;
      process.env.COLORTERM = previousColorTerm;
    }
  });

  it('reports configured LangSmith project and endpoint without exposing the API key', () => {
    expect(
      formatLangSmithStatus({
        LANGSMITH_TRACING: 'true',
        LANGSMITH_API_KEY: 'secret-key',
        LANGSMITH_PROJECT: 'TrendMiner MCP | mcplab',
        LANGSMITH_ENDPOINT: 'https://eu.api.smith.langchain.com'
      })
    ).toBe(
      '✓ enabled · project: TrendMiner MCP | mcplab · endpoint: https://eu.api.smith.langchain.com'
    );
  });

  it('reports disabled LangSmith tracing with an enablement hint', () => {
    expect(formatLangSmithStatus({})).toBe(
      'disabled · set LANGSMITH_TRACING=true and LANGSMITH_API_KEY to enable'
    );
  });

  it('aligns app startup labels without terminal tab expansion', () => {
    expect(formatCliStartupLine('evals:', '/tmp/evals')).toBe(
      '[mcplab-app]  evals:     /tmp/evals'
    );
    expect(formatCliStartupLine('langsmith:', 'enabled · project: demo')).toBe(
      '[mcplab-app]  langsmith: enabled · project: demo'
    );
  });
});
