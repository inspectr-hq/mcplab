import type { ResultsJson } from '@mcp-lab/core';
import { renderHtml } from './html.js';

export function renderReport(results: ResultsJson): string {
  return renderHtml(results);
}
