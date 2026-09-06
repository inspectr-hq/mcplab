import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ToolAnalysisResultsPage from './ToolAnalysisResults';

const { sourceMock } = vi.hoisted(() => ({
  sourceMock: {
    listToolAnalysisResults: vi.fn(),
    listToolAnalysisServers: vi.fn(),
    deleteToolAnalysisSavedResult: vi.fn(),
    getToolAnalysisSavedResult: vi.fn()
  }
}));

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({ source: sourceMock })
}));

describe('ToolAnalysisResultsPage', () => {
  it('shows the estimated token badge for each saved report', async () => {
    sourceMock.listToolAnalysisServers.mockResolvedValue(['demo']);
    sourceMock.listToolAnalysisResults.mockResolvedValue([
      {
        reportId: 'ta-existing',
        createdAt: '2026-09-05T23:03:14.000Z',
        assistantAgentName: 'agent',
        assistantAgentModel: 'model',
        serverNames: ['demo'],
        modes: { metadataReview: true, deeperAnalysis: false },
        summary: {
          serversAnalyzed: 1,
          toolsAnalyzed: 1,
          toolsSkipped: 0,
          issueCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
        },
        toolDefinitionTokens: 42
      }
    ]);

    render(
      <MemoryRouter>
        <ToolAnalysisResultsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('~42tok')).toBeInTheDocument();
  });
});
