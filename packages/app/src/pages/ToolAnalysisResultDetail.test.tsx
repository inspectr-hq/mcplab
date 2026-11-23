import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { SavedToolAnalysisReportRecord } from '@/lib/data-sources/types';
import ToolAnalysisResultDetailPage from './ToolAnalysisResultDetail';

const { source } = vi.hoisted(() => ({
  source: { getToolAnalysisSavedResult: vi.fn(), deleteToolAnalysisSavedResult: vi.fn() }
}));

vi.mock('@/contexts/useDataSource', () => ({
  useDataSource: () => ({ source })
}));

function renderReport(hasTools: boolean) {
  const reportId = 'ta-test';
  const createdAt = '2026-11-18T20:00:00.000Z';
  const record: SavedToolAnalysisReportRecord = {
    recordVersion: 1,
    reportId,
    createdAt,
    sourceJobId: 'job-test',
    serverNames: ['demo'],
    report: {
      schemaVersion: 1,
      createdAt,
      modes: { catalogChecks: true, metadataReview: false, deeperAnalysis: false },
      settings: {},
      summary: {
        serversAnalyzed: 1,
        toolsAnalyzed: 0,
        toolsSkipped: 0,
        issueCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
      },
      servers: [
        {
          serverName: 'demo',
          toolCountDiscovered: hasTools ? 1 : 0,
          toolCountAnalyzed: 0,
          toolCountSkipped: 0,
          warnings: [],
          tools: hasTools
            ? [
                {
                  serverName: 'demo',
                  toolName: 'lookup',
                  publicToolName: 'demo::lookup',
                  safetyClassification: 'read_only',
                  classificationReason: 'Read-only tool',
                  overallRecommendations: []
                }
              ]
            : []
        }
      ],
      findings: []
    }
  };

  source.getToolAnalysisSavedResult.mockResolvedValue(record);
  return render(
    <MemoryRouter initialEntries={[`/tool-analysis-results/${reportId}`]}>
      <Routes>
        <Route path="/tool-analysis-results/:id" element={<ToolAnalysisResultDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('saved MCP analysis report actions', () => {
  it.each([false, true])(
    'shows direct exports and keeps deletion behind confirmation (tools=%s)',
    async (hasTools) => {
      renderReport(hasTools);

      const actions = within(await screen.findByRole('group', { name: 'Report actions' }));
      expect(actions.getByRole('button', { name: 'Export JSON' })).toBeVisible();
      expect(actions.getByRole('button', { name: 'Export Markdown' })).toBeVisible();
      if (hasTools) expect(actions.getByRole('button', { name: 'Export MCP info' })).toBeVisible();
      else
        expect(actions.queryByRole('button', { name: 'Export MCP info' })).not.toBeInTheDocument();

      fireEvent.click(actions.getByRole('button', { name: 'Delete report' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveAccessibleName('Delete tool analysis report?');
      expect(source.deleteToolAnalysisSavedResult).not.toHaveBeenCalled();
    }
  );
});
