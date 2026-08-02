import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GlobalCopilotThreadList } from './GlobalCopilotThreadList';

describe('GlobalCopilotThreadList', () => {
  it('uses a bounded scroll viewport when all conversations are shown', async () => {
    render(
      <GlobalCopilotThreadList
        threads={Array.from({ length: 7 }, (_, index) => ({
          version: 1 as const,
          id: `thread-${index}`,
          workspaceKey: 'workspace',
          title: `Conversation ${index}`,
          createdAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
          messages: []
        }))}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'All conversations (7)' }));
    expect(screen.getByTestId('global-copilot-thread-list-scroll-area')).toHaveClass('h-48');
  });
});
