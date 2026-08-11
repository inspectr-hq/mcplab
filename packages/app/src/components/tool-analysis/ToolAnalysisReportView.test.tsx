import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToolAnalysisReportView, toolAnalysisReportToMarkdown } from './ToolAnalysisReportView';
import type { ToolAnalysisReport } from '@/lib/data-sources/types';

const report: ToolAnalysisReport = {
  schemaVersion: 1,
  createdAt: '2026-04-17T12:00:00.000Z',
  assistantAgentName: 'test-agent',
  assistantAgentModel: 'test-model',
  modes: { metadataReview: true, deeperAnalysis: false },
  settings: {},
  summary: {
    serversAnalyzed: 1,
    toolsAnalyzed: 1,
    toolsSkipped: 0,
    issueCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  },
  findings: [],
  servers: [
    {
      serverName: 'demo',
      toolCountDiscovered: 1,
      toolCountAnalyzed: 1,
      toolCountSkipped: 0,
      warnings: [],
      tools: [
        {
          serverName: 'demo',
          toolName: 'get_user_profile',
          publicToolName: 'demo::get_user_profile',
          description: 'Get a user profile',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
          outputSchema: {
            type: 'object',
            properties: { name: { type: 'string' }, age: { type: 'number' } },
            required: ['name']
          },
          safetyClassification: 'read_only',
          classificationReason: 'read prefix',
          metadataReview: {
            strengths: [],
            issues: [],
            suggestedSchemaChanges: [],
            evalReadinessNotes: []
          },
          overallRecommendations: []
        }
      ]
    }
  ]
};

describe('toolAnalysisReportToMarkdown', () => {
  it('does not throw when a tool schema contains a circular reference', () => {
    const circular: Record<string, unknown> = { type: 'object' };
    circular['self'] = circular;
    const circularReport: ToolAnalysisReport = {
      ...report,
      servers: [
        {
          ...report.servers[0],
          tools: [{ ...report.servers[0].tools[0], inputSchema: circular, outputSchema: circular }]
        }
      ]
    };
    expect(() => toolAnalysisReportToMarkdown(circularReport)).not.toThrow();
  });

  it('renders schema blocks in markdown output when schemas present', () => {
    const md = toolAnalysisReportToMarkdown(report);
    expect(md).toContain('Input schema');
    expect(md).toContain('Output schema');
    expect(md).toContain('"name"');
  });
});

describe('ToolAnalysisReportView', () => {
  it('renders output schema details when available', () => {
    render(
      <MemoryRouter>
        <ToolAnalysisReportView report={report} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('get_user_profile'));
    fireEvent.click(screen.getByText('Schemas'));

    expect(screen.getByText('Output schema')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'EXPLORER' })).toHaveAttribute('aria-selected', 'true');
  });

  it('copies input and output schemas as JSON', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    render(
      <MemoryRouter>
        <ToolAnalysisReportView report={report} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('get_user_profile'));
    fireEvent.click(screen.getByText('Schemas'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy input schema JSON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy output schema JSON' }));

    expect(writeText).toHaveBeenNthCalledWith(1, JSON.stringify(report.servers[0].tools[0].inputSchema, null, 2));
    expect(writeText).toHaveBeenNthCalledWith(2, JSON.stringify(report.servers[0].tools[0].outputSchema, null, 2));
  });

  it('supports Explorer and JSON schema modes', () => {
    render(
      <MemoryRouter>
        <ToolAnalysisReportView report={report} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('get_user_profile'));
    fireEvent.click(screen.getByText('Schemas'));

    fireEvent.click(screen.getAllByRole('tab', { name: 'EXPLORER' })[0]);
    expect(screen.getAllByRole('button', { name: 'Expand All' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Collapse All' })).toHaveLength(2);
    expect(screen.getByText('1 Properties')).toBeInTheDocument();
    expect(screen.getByText('2 Properties')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse All' })[0]);
    expect(screen.getAllByRole('button', { name: 'Expand root' })[0]).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getAllByRole('button', { name: 'Collapse root' })[0]).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand All' })[0]);
    expect(screen.getAllByRole('button', { name: 'Collapse root' })[0]).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    expect(screen.getAllByText('Properties')).not.toHaveLength(0);
    fireEvent.click(screen.getAllByRole('tab', { name: 'JSON' })[0]);
    expect(screen.getAllByText(/"type": "object"/)).not.toHaveLength(0);
  });

  it('supports an expandable explorer schema mode', () => {
    render(
      <MemoryRouter>
        <ToolAnalysisReportView
          report={{
            ...report,
            servers: [
              {
                ...report.servers[0],
                tools: [
                  {
                    ...report.servers[0].tools[0],
                    inputSchema: {
                      type: 'object',
                      properties: {
                        profile: {
                          type: 'object',
                          description: 'Profile details',
                          properties: { id: { type: 'string' } },
                          required: ['id']
                        },
                        tags: { type: 'array', items: { type: 'string' } }
                      },
                      required: ['profile']
                    }
                  }
                ]
              }
            ]
          }}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('get_user_profile'));
    fireEvent.click(screen.getByText('Schemas'));
    fireEvent.click(screen.getByRole('tab', { name: 'EXPLORER' }));

    expect(screen.getByText('profile')).toBeInTheDocument();
    expect(screen.getByText('Profile details')).toBeInTheDocument();
    expect(screen.getAllByText('required')).not.toHaveLength(0);
    expect(screen.queryByText('id')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /profile/i }));

    expect(screen.getByText('id')).toBeInTheDocument();
  });

  it('does not throw when rendering a tool with a circular schema', () => {
    const circular: Record<string, unknown> = { type: 'object' };
    circular['self'] = circular;
    const circularReport: ToolAnalysisReport = {
      ...report,
      servers: [
        {
          ...report.servers[0],
          tools: [{ ...report.servers[0].tools[0], inputSchema: circular, outputSchema: circular }]
        }
      ]
    };
    expect(() =>
      render(
        <MemoryRouter>
          <ToolAnalysisReportView report={circularReport} />
        </MemoryRouter>
      )
    ).not.toThrow();
  });
});
