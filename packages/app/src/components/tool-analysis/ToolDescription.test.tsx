import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolDescription } from './ToolDescription';

describe('ToolDescription', () => {
  it('expands long descriptions and lets them collapse again', () => {
    const text = 'Find matching records in the selected search window. '.repeat(4);
    render(<ToolDescription text={text} />);

    const description = screen.getByText((_, element) => element?.tagName === 'P');
    const toggle = screen.getByRole('button', { name: 'Show more' });
    expect(description).toHaveClass('line-clamp-2');

    fireEvent.click(toggle);
    expect(description).not.toHaveClass('line-clamp-2');
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(description).toHaveClass('line-clamp-2');
  });

  it('does not show a toggle for short descriptions', () => {
    render(<ToolDescription text="Find a matching record." />);

    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });
});
