import type { ResultsJson } from '@mcp-eval/core';
import { renderHtml } from './html.js';

export function renderReport(results: ResultsJson): string {
  return renderHtml(results);
}
