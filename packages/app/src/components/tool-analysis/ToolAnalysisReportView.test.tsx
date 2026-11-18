import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToolAnalysisReportView } from './ToolAnalysisReportView';
import { toolAnalysisReportToMarkdown } from '@/lib/tool-analysis-markdown';
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
      tokenEstimate: {
        toolCount: 1,
        total: 42,
        tools: [{ name: 'get_user_profile', total: 42 }],
        method: 'js_tiktoken_fallback'
      },
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

const catalogReport: ToolAnalysisReport = {
  ...report,
  assistantAgentName: undefined,
  assistantAgentModel: undefined,
  modes: { catalogChecks: true, metadataReview: false, deeperAnalysis: false },
  summary: {
    ...report.summary,
    toolsAnalyzed: 0,
    catalogChecks: { itemsChecked: 1, statusCounts: { pass: 0, warning: 1, fail: 0, skipped: 1 } }
  },
  servers: [
    {
      ...report.servers[0],
      tools: [],
      toolCountAnalyzed: 0,
      catalogChecks: [
        {
          kind: 'prompts',
          status: 'warning',
          itemsChecked: 1,
          findings: [
            {
              status: 'warning',
              item: 'review',
              path: '/description',
              message: 'Description is missing.'
            }
          ]
        },
        {
          kind: 'tool_resources',
          status: 'skipped',
          itemsChecked: 0,
          findings: [],
          message: 'Listing these resources requires executing a tool.'
        }
      ]
    }
  ]
};

describe('toolAnalysisReportToMarkdown', () => {
  it('exports catalog findings and skip reasons without assistant fields', () => {
    const md = toolAnalysisReportToMarkdown(catalogReport);
    expect(md).toContain('Prompts · Warning · 1 checked');
    expect(md).toContain('review · /description · Description is missing.');
    expect(md).toContain('Listing these resources requires executing a tool.');
    expect(md).not.toContain('Assistant Agent');
    expect(JSON.parse(JSON.stringify(catalogReport)).servers[0].catalogChecks).toEqual(
      catalogReport.servers[0].catalogChecks
    );
  });

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
  it('shows catalog status, coverage, evidence, and skip reasons', () => {
    render(<ToolAnalysisReportView report={catalogReport} />);
    expect(screen.getByRole('heading', { name: 'Catalog checks for demo' })).toBeVisible();
    expect(screen.getAllByText('Warning')[0]).toBeVisible();
    expect(screen.getByText('1 checked')).toBeVisible();
    expect(screen.getByText('Skipped')).toBeVisible();
    expect(screen.getByText('Listing these resources requires executing a tool.')).toBeVisible();
    fireEvent.click(screen.getByText('1 finding'));
    expect(screen.getByText('/description')).toBeInTheDocument();
    expect(screen.queryByText('Tools analyzed')).not.toBeInTheDocument();
  });

  it('shows aggregate and per-tool token badges for saved reports', () => {
    render(
      <MemoryRouter>
        <ToolAnalysisReportView report={report} />
      </MemoryRouter>
    );

    expect(
      screen.getAllByTitle('Estimated tokens for this tool definition and its schemas')
    ).toHaveLength(1);
    expect(
      screen.getAllByTitle('Estimated tokens for the analyzed tool definitions and their schemas')
    ).toHaveLength(1);
  });

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

    expect(writeText).toHaveBeenNthCalledWith(
      1,
      JSON.stringify(report.servers[0].tools[0].inputSchema, null, 2)
    );
    expect(writeText).toHaveBeenNthCalledWith(
      2,
      JSON.stringify(report.servers[0].tools[0].outputSchema, null, 2)
    );
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
