import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
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
          safetyClassification: 'read_like',
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

    expect(screen.getByText('Output schema')).toBeInTheDocument();
    expect(screen.getByText(/"name": \{/)).toBeInTheDocument();
  });
});
