import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolActivity, ToolApprovalCard, type AssistantToolCall } from './AssistantToolCalls';

const call = (overrides: Partial<AssistantToolCall> = {}): AssistantToolCall => ({
  id: 'call-1',
  server: 'slack',
  tool: 'post_to_slack',
  publicToolName: 'slack__post_to_slack',
  arguments: { channel: '#growth', text: 'Conversion fell' },
  status: 'pending',
  createdAt: '2026-10-16T10:00:00.000Z',
  requiresApproval: true,
  ...overrides
});

describe('ToolApprovalCard', () => {
  it('shows what approving does: title, purpose, risks and labelled arguments', () => {
    render(
      <ToolApprovalCard
        call={call({
          title: 'Post to Slack',
          description: 'Posts a message under your name.',
          hints: { destructive: true },
          argumentLabels: { channel: 'Channel' }
        })}
      />
    );
    expect(screen.getByRole('group', { name: 'Approval needed: Post to Slack' })).toBeVisible();
    expect(screen.getByText('Posts a message under your name.')).toBeVisible();
    expect(screen.getByText('Can change or delete data')).toBeVisible();
    expect(screen.getByText('Channel')).toBeVisible();
    expect(screen.getByText('#growth')).toBeVisible();
  });

  it('denies with the reason the user gives, or without one', () => {
    const onDeny = vi.fn();
    const { rerender } = render(<ToolApprovalCard call={call()} onDeny={onDeny} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenLastCalledWith('call-1');

    rerender(<ToolApprovalCard call={call({ id: 'call-2' })} onDeny={onDeny} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    fireEvent.change(screen.getByLabelText('Reason for denying'), {
      target: { value: ' Use #growth-alerts ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenLastCalledWith('call-2', 'Use #growth-alerts');
  });

  it('approves with Cmd+Enter while the card has focus', () => {
    const onApprove = vi.fn();
    render(<ToolApprovalCard call={call()} onApprove={onApprove} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Approve' }), {
      key: 'Enter',
      metaKey: true
    });
    expect(onApprove).toHaveBeenCalledWith('call-1');
  });

  it('collapses a decided call to its outcome, keeping the reason or error visible', () => {
    const { rerender } = render(
      <ToolApprovalCard
        call={call({
          status: 'denied',
          error: 'User denied tool call',
          denyMessage: 'Wait for the payments team'
        })}
      />
    );
    expect(screen.getByText('Denied')).toBeVisible();
    expect(screen.getByText('“Wait for the payments team”')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

    rerender(
      <ToolApprovalCard
        call={call({
          status: 'error',
          error: 'GitHub returned 403',
          startedAt: '2026-10-16T10:00:00.000Z',
          completedAt: '2026-10-16T10:00:03.700Z'
        })}
      />
    );
    expect(screen.getByText('GitHub returned 403')).toBeVisible();
    expect(screen.getByText(/3\.7s/)).toBeVisible();
  });
});

describe('ToolActivity', () => {
  it('groups calls that ran without asking into compact rows', () => {
    render(
      <ToolActivity
        calls={[
          call({
            id: 'a',
            tool: 'read_mcp_resource',
            title: 'Read MCP resource',
            arguments: { server: 'docs', uri: 'docs://guide' },
            status: 'approved',
            resultPreview: '{"ok":true}',
            requiresApproval: false,
            startedAt: '2026-10-16T10:00:00.000Z',
            completedAt: '2026-10-16T10:00:00.400Z'
          }),
          call({
            id: 'b',
            tool: 'lookup',
            arguments: { tag: 'TM-104' },
            status: 'error',
            error: 'Not found',
            requiresApproval: false
          })
        ]}
      />
    );
    expect(screen.getByText('Used 2 tools')).toBeVisible();
    expect(screen.getByText('1 failed')).toBeVisible();
    fireEvent.click(screen.getByText('Used 2 tools'));
    expect(screen.getByText('docs://guide')).toBeVisible();
    expect(screen.getByText('400ms')).toBeVisible();
    expect(screen.getByText('Not found')).toBeVisible();
  });
});
