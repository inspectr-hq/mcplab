import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GlobalCopilotConversation } from './GlobalCopilotConversation';

describe('GlobalCopilotConversation', () => {
  it('uses a zero-height flex basis so a long action payload scrolls inside the sidebar', () => {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    });
    const { container } = render(
      <div className="flex h-40 flex-col overflow-hidden">
        <GlobalCopilotConversation
          loading={false}
          messages={[
            {
              id: 'create-test-case',
              role: 'system',
              content: 'Library duplicate requested.',
              createdAt: '2026-08-02T00:00:00.000Z',
              action: {
                kind: 'library_action',
                name: 'create_test_case',
                arguments: { prompt: 'A long payload '.repeat(500) },
                status: 'pending'
              }
            }
          ]}
          onCopy={vi.fn()}
          onContinue={vi.fn()}
          onOpenResult={vi.fn()}
          onRunEvaluation={vi.fn()}
          onCreateEvaluationConfig={vi.fn()}
          onWriteReport={vi.fn()}
          onExternalTool={vi.fn()}
          onStartAction={vi.fn()}
          onLibraryAction={vi.fn()}
        />
      </div>
    );

    expect(container.querySelector('[data-radix-scroll-area-viewport]')?.parentElement).toHaveClass(
      'h-0',
      'flex-1',
      'min-h-0'
    );
    expect(container.querySelector('[data-radix-scroll-area-viewport]')?.parentElement).toHaveClass(
      '[&_[data-radix-scroll-area-viewport]>div]:!min-w-0',
      '[&_[data-radix-scroll-area-viewport]>div]:!w-full'
    );
  });
});
