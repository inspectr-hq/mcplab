import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolDescription } from './ToolDescription';

describe('ToolDescription', () => {
  it('always shows the full description without a toggle', () => {
    const text = 'Find matching records in the selected search window. '.repeat(4);
    render(<ToolDescription text={text} />);

    const description = screen.getByText((_, element) => element?.tagName === 'P');
    expect(description).toHaveTextContent(text.trim());
    expect(description).not.toHaveClass('line-clamp-2');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
