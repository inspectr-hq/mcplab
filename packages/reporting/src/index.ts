import type { ResultsJson } from '@inspectr/mcplab-core';
import { renderHtml } from './html.js';

export function renderReport(results: ResultsJson): string {
  return renderHtml(results);
}
