import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listToolAnalysisReports,
  readToolAnalysisReportRecord,
  writeToolAnalysisReportRecord
} from './tool-analysis-storage.js';

const tempDirs: string[] = [];

describe('tool analysis report storage', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('derives health and token totals when reopening an older report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-tool-analysis-storage-'));
    tempDirs.push(dir);
    const file = writeToolAnalysisReportRecord(dir, {
      recordVersion: 1,
      reportId: 'ta-existing',
      createdAt: '2026-09-05T23:03:14.000Z',
      sourceJobId: 'job-1',
      serverNames: ['demo'],
      report: {
        schemaVersion: 1,
        createdAt: '2026-09-05T23:03:14.000Z',
        assistantAgentName: 'agent',
        assistantAgentProvider: 'azure',
        assistantAgentModel: 'model',
        modes: { metadataReview: true, deeperAnalysis: false },
        settings: {},
        mcpServerVersions: { demo: '1.0.0' },
        summary: {
          serversAnalyzed: 1,
          toolsAnalyzed: 1,
          toolsSkipped: 0,
          issueCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
        },
        servers: [
          {
            serverName: 'demo',
            toolCountDiscovered: 1,
            toolCountAnalyzed: 1,
            toolCountSkipped: 0,
            warnings: [],
            catalogChecks: [
              {
                kind: 'tools',
                status: 'warning',
                itemsChecked: 1,
                findings: [
                  {
                    item: 'search_docs',
                    path: '/annotations',
                    status: 'warning',
                    message: 'Tool does not declare read-only or destructive behavior.'
                  }
                ]
              }
            ],
            tools: [
              {
                serverName: 'demo',
                toolName: 'search_docs',
                publicToolName: 'demo::search_docs',
                description: 'Search documentation',
                inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
                safetyClassification: 'read_only',
                classificationReason: 'read prefix',
                overallRecommendations: []
              }
            ]
          }
        ],
        findings: []
      }
    });

    const loaded = readToolAnalysisReportRecord(dir, 'ta-existing')?.report.servers[0];
    expect(loaded?.tokenEstimate?.total).toBeGreaterThan(0);
    expect(loaded?.health?.toolCount).toBe(1);
    expect(loaded?.health?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'connection', status: 'skipped' }),
        expect.objectContaining({ id: 'listing', status: 'pass' }),
        expect.objectContaining({ id: 'safety', status: 'warning' }),
        expect.objectContaining({ id: 'samples', status: 'skipped' })
      ])
    );
    expect(JSON.parse(readFileSync(file, 'utf8')).report.servers[0]).not.toHaveProperty('health');
    expect(listToolAnalysisReports(dir)[0]).not.toHaveProperty('toolDefinitionTokens');
    expect(listToolAnalysisReports(dir)[0]?.mcpServerVersions).toEqual({ demo: '1.0.0' });
  });
});
