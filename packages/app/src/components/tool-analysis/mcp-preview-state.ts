import { useEffect, useRef, useState } from 'react';
import type { McpPreviewRequest, McpPreviewResponse } from '@/lib/data-sources/types';

export type PreviewState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: McpPreviewResponse };

export type InlinePreview = 'skill' | 'manifest' | 'markdown' | 'raw';

export type LoadMcpPreview = (
  request: McpPreviewRequest,
  signal: AbortSignal
) => Promise<McpPreviewResponse>;

export function resourceInlinePreview(uri: string, mimeType?: string): InlinePreview | undefined {
  const [path] = uri.split(/[?#]/, 1);
  if (path.endsWith('/SKILL.md')) return 'skill';
  if (!/^skill:\/\//i.test(uri)) return undefined;
  if (path.endsWith('/_manifest')) return 'manifest';
  const mediaType = mimeType?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType === 'text/markdown' || /\.(?:md|markdown)$/i.test(path)) return 'markdown';
  return 'raw';
}

export function useMcpPreviewRequest(load: LoadMcpPreview) {
  const [state, setState] = useState<PreviewState>({ status: 'idle' });
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const reset = () => {
    active.current?.abort();
    setState({ status: 'idle' });
  };

  const loadPreview = async (request: McpPreviewRequest) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ status: 'loading' });
    try {
      const response = await load(request, controller.signal);
      if (!controller.signal.aborted) setState({ status: 'ready', response });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };

  return { state, loadPreview, reset };
}
