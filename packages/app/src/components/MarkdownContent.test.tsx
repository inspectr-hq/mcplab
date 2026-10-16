import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from './MarkdownContent';

describe('MarkdownContent', () => {
  it('renders nested list items inside their parent item', () => {
    const { container } = render(
      <MarkdownContent
        text={[
          'Recommendation:',
          '',
          '- Remove the `Time range check` assertion',
          '- Keep:',
          '  - required tool assertion,',
          '  - response regex checks.'
        ].join('\n')}
      />
    );
    const outer = container.querySelector('ul')!;
    expect(outer.children).toHaveLength(2);
    const keep = outer.children[1] as HTMLElement;
    expect(within(keep).getAllByRole('listitem')).toHaveLength(2);
    expect(within(keep).getByText('required tool assertion,')).toBeVisible();
    expect(screen.getByText('Time range check').tagName).toBe('CODE');
  });

  it('renders fenced code with its language, tables and links', () => {
    render(
      <MarkdownContent
        text={[
          '```yaml',
          'agent: luna-6',
          '```',
          '',
          '| Run | Pass |',
          '| --- | --- |',
          '| a | 100% |',
          '',
          'See [the docs](https://example.com).'
        ].join('\n')}
      />
    );
    expect(screen.getByText('yaml')).toBeVisible();
    expect(screen.getByText('agent: luna-6')).toBeVisible();
    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.getByRole('cell', { name: '100%' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute('target', '_blank');
  });

  it('shows raw HTML as text instead of rendering it', () => {
    const { container } = render(<MarkdownContent text={'<img src=x onerror="alert(1)">'} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
