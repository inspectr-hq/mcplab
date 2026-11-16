import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolEventRow } from './ScenarioEvidence';

describe('ToolEventRow', () => {
  it('shows the raw content control before the content toggle', () => {
    render(
      <ToolEventRow
        variant="result_ok"
        title="Tool result · search · ok"
        text='{"ok":true}'
        copyLabel="tool result search"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Format JSON' }));

    const showRaw = screen.getByRole('button', { name: 'Show raw' });
    const showContent = screen.getByRole('button', { name: 'Show content' });
    expect(showRaw.compareDocumentPosition(showContent)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
