import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docsPages } from '@/data/docs';

const pageText = (slug: string) => JSON.stringify(docsPages.find((page) => page.slug === slug));

describe('public Rover documentation', () => {
  it('covers current public providers, installation, and execution workflows', () => {
    const rover = pageText('app-rover');

    expect(rover).toContain('ChatGPT');
    expect(rover).toContain('learned provider');
    expect(rover).toContain('GitHub Releases');
    expect(rover).toContain('new_conversation_between_scenarios');
    expect(rover).toContain('MCPLab-managed');
    expect(rover).toContain('Manual tab');
    expect(rover).toContain('manual fallback');
    expect(rover).toContain('local evaluation queue');
  });

  it('documents the browser-agent configuration variant', () => {
    const reference = docsPages.find((page) => page.slug === 'reference-configuration');
    const agents = JSON.stringify(reference?.sections.find((section) => section.id === 'agents-schema'));

    expect(agents).toContain('type: browser');
    expect(agents).toContain('Browser agent url (string, required)');
    expect(agents).toContain('new_conversation_between_scenarios');
  });

  it('does not expose internal-only provider branding', () => {
    const internalOnlyProvider = ['trend', 'miner'].join('');
    expect(JSON.stringify(docsPages).toLowerCase()).not.toContain(internalOnlyProvider);
  });

  it('promotes Rover from the landing page', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/pages/index.astro'),
      'utf8'
    );

    expect(source).toContain('RoverFeature');
  });
});
