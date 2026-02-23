import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolAnalysisReport } from './tool-analysis-domain.js';

export interface SavedToolAnalysisReportRecord {
  recordVersion: 1;
  reportId: string;
  createdAt: string;
  sourceJobId: string;
  serverNames: string[];
  report: ToolAnalysisReport;
}

export interface ToolAnalysisResultSummary {
  reportId: string;
  createdAt: string;
  assistantAgentName: string;
  assistantAgentModel: string;
  serverNames: string[];
  modes: ToolAnalysisReport['modes'];
  summary: ToolAnalysisReport['summary'];
}

function reportDir(baseDir: string, reportId: string): string {
  return join(baseDir, reportId);
}

function reportFile(baseDir: string, reportId: string): string {
  return join(reportDir(baseDir, reportId), 'report.json');
}

function parseRecord(raw: string): SavedToolAnalysisReportRecord {
  const parsed = JSON.parse(raw) as Partial<SavedToolAnalysisReportRecord>;
  if (
    parsed.recordVersion !== 1 ||
    typeof parsed.reportId !== 'string' ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.sourceJobId !== 'string' ||
    !Array.isArray(parsed.serverNames) ||
    !parsed.report
  ) {
    throw new Error('Invalid tool analysis report record');
  }
  return parsed as SavedToolAnalysisReportRecord;
}

export function createToolAnalysisReportId(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const suffix = Math.random().toString(36).slice(2, 8);
  return `ta-${ts}-${suffix}`;
}

export function writeToolAnalysisReportRecord(
  baseDir: string,
  record: SavedToolAnalysisReportRecord
): string {
  const dir = reportDir(baseDir, record.reportId);
  mkdirSync(dir, { recursive: true });
  const filePath = reportFile(baseDir, record.reportId);
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return filePath;
}

export function readToolAnalysisReportRecord(
  baseDir: string,
  reportId: string
): SavedToolAnalysisReportRecord | null {
  try {
    return parseRecord(readFileSync(reportFile(baseDir, reportId), 'utf8'));
  } catch {
    return null;
  }
}

export function listToolAnalysisReports(baseDir: string): ToolAnalysisResultSummary[] {
  mkdirSync(baseDir, { recursive: true });
  const entries = readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const summaries: ToolAnalysisResultSummary[] = [];
  for (const reportId of entries) {
    try {
      const filePath = reportFile(baseDir, reportId);
      const st = statSync(filePath);
      if (!st.isFile()) continue;
      const record = parseRecord(readFileSync(filePath, 'utf8'));
      summaries.push({
        reportId: record.reportId,
        createdAt: record.createdAt,
        assistantAgentName: record.report.assistantAgentName,
        assistantAgentModel: record.report.assistantAgentModel,
        serverNames: record.serverNames,
        modes: record.report.modes,
        summary: record.report.summary
      });
    } catch (error) {
      console.warn(`Skipping invalid tool analysis report '${reportId}':`, error);
    }
  }
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summaries;
}

export function deleteToolAnalysisReportRecord(baseDir: string, reportId: string): boolean {
  const dir = reportDir(baseDir, reportId);
  try {
    rmSync(dir, { recursive: true, force: false });
    return true;
  } catch {
    return false;
  }
}

