import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { WorkspaceDefaultAgentNotice } from './WorkspaceDefaultAgentNotice';

describe('WorkspaceDefaultAgentNotice', () => {
  it('shows an inherited LLM agent as a library-style card', () => {
    render(
      <MemoryRouter>
        <WorkspaceDefaultAgentNotice
          name="claude-haiku-55"
          loading={false}
          agents={[
            {
              id: 'claude-haiku-55',
              name: 'Claude Haiku 3.5',
              provider: 'anthropic',
              model: 'claude-3-5-haiku',
              maxTokens: 2048
            }
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('status')).toHaveClass('rounded-lg');
    expect(screen.getByText(/Workspace default agent: Claude Haiku 3.5/)).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('claude-3-5-haiku')).toBeInTheDocument();
    expect(screen.getByTitle('LLM agent')).toBeInTheDocument();
    expect(
      screen.queryByText(/Inherited because this evaluation has no agents/)
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Workspace settings' })).toBeInTheDocument();
  });

  it('shows browser type and invalid-default feedback', () => {
    render(
      <MemoryRouter>
        <WorkspaceDefaultAgentNotice
          name="browser"
          loading={false}
          agents={[
            {
              id: 'browser',
              name: 'Browser Agent',
              type: 'browser',
              provider: 'chatgpt',
              model: '',
              maxTokens: 0,
              url: 'https://chatgpt.com'
            }
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByTitle('Browser agent')).toBeInTheDocument();
    expect(screen.getByText(/workspace default must be an LLM agent/)).toBeInTheDocument();
  });
});
