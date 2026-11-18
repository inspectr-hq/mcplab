import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import ToolAnalysisPage from './ToolAnalysis';

const { source } = vi.hoisted(() => ({
  source: {
    getWorkspaceSettings: vi.fn(),
    discoverToolsForAnalysis: vi.fn(),
    previewMcpForAnalysis: vi.fn(),
    startToolAnalysis: vi.fn(),
    subscribeToolAnalysisJob: vi.fn()
  }
}));

vi.mock('@/contexts/useDataSource', () => ({ useDataSource: () => ({ source }) }));
vi.mock('@/contexts/useLibraries', () => ({
  useLibraries: () => ({
    servers: [
      { id: 'alpha', name: 'Alpha' },
      { id: 'beta', name: 'Beta' }
    ],
    agents: [{ name: 'Agent' }]
  })
}));

const alpha = {
  serverName: 'alpha',
  warnings: [],
  tools: [
    { name: 'fetch_docs', safetyClassification: 'read_only', classificationReason: 'read prefix' }
  ],
  catalog: {
    resources: { status: 'ready', items: [{ name: 'Guide', uri: 'docs://guide' }] },
    resourceTemplates: {
      status: 'ready',
      items: [{ name: 'Page', uriTemplate: 'docs://pages/{id}' }]
    },
    prompts: {
      status: 'ready',
      items: [{ name: 'review', arguments: [{ name: 'topic', required: true }, { name: 'note' }] }]
    }
  }
};

function renderPage() {
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ToolAnalysisPage />
      </TooltipProvider>
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
}

function openTab(name: string) {
  fireEvent.keyDown(screen.getByRole('tab', { name }), { key: 'Enter' });
}

describe('Analyze MCP catalog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    source.getWorkspaceSettings.mockResolvedValue(null);
    source.discoverToolsForAnalysis.mockResolvedValue({ servers: [alpha] });
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists tool-backed resources explicitly and previews a skill file via its server tool', async () => {
    const catalog = {
      ...alpha.catalog,
      resources: { status: 'unsupported' },
      resourceTemplates: { status: 'unsupported' }
    };
    source.discoverToolsForAnalysis.mockResolvedValueOnce({
      servers: [{ ...alpha, catalog: { ...catalog, toolResources: { status: 'available' } } }]
    });
    source.discoverToolsForAnalysis.mockResolvedValueOnce({
      servers: [
        {
          ...alpha,
          catalog: {
            ...catalog,
            toolResources: {
              status: 'ready',
              canRead: true,
              resources: [{ name: 'Review', uri: 'skill://review/SKILL.md' }],
              resourceTemplates: [{ name: 'Page', uriTemplate: 'docs://pages/{id}' }]
            }
          }
        }
      ]
    });
    source.previewMcpForAnalysis.mockResolvedValue({
      kind: 'resource',
      contents: [{ uri: 'skill://review/SKILL.md', text: '# Review' }]
    });
    renderPage();
    await screen.findByText('fetch_docs');
    expect(source.discoverToolsForAnalysis).toHaveBeenCalledWith(
      { serverNames: ['alpha'], includeCatalog: true },
      expect.any(AbortSignal)
    );
    openTab('Resources');
    fireEvent.click(screen.getByRole('button', { name: 'List via server tool' }));
    expect(await screen.findByText('Skill file')).toBeVisible();
    expect(screen.getByText('docs://pages/{id}')).toBeVisible();
    expect(source.discoverToolsForAnalysis).toHaveBeenLastCalledWith(
      { serverNames: ['alpha'], includeCatalog: true, includeToolResources: true },
      expect.any(AbortSignal)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview Review' }));
    expect(await screen.findByText('# Review')).toBeVisible();
    expect(source.previewMcpForAnalysis).toHaveBeenCalledWith(
      { kind: 'resource', serverName: 'alpha', uri: 'skill://review/SKILL.md', via: 'tool' },
      expect.any(AbortSignal)
    );
  });

  it('previews resource content and reads a concrete URI from a template', async () => {
    source.previewMcpForAnalysis.mockResolvedValue({
      kind: 'resource',
      contents: [
        { uri: 'docs://guide', text: '<strong>Literal content</strong>' },
        { uri: 'docs://logo', mimeType: 'image/png', blobBytes: 14 }
      ]
    });
    renderPage();
    expect(await screen.findByText('fetch_docs')).toBeVisible();
    openTab('Resources');
    expect(source.previewMcpForAnalysis).not.toHaveBeenCalled();
    const guide = screen.getByRole('button', { name: 'Preview Guide' });
    guide.focus();
    fireEvent.click(guide);
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('<strong>Literal content</strong>')).toBeVisible();
    expect(within(dialog).getByText(/14 bytes/)).toBeVisible();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Page' }));
    fireEvent.change(screen.getByLabelText('Resource URI'), {
      target: { value: 'docs://pages/42' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read resource' }));
    expect(await screen.findByText('<strong>Literal content</strong>')).toBeVisible();
    expect(source.previewMcpForAnalysis).toHaveBeenLastCalledWith(
      { kind: 'resource', serverName: 'alpha', uri: 'docs://pages/42' },
      expect.any(AbortSignal)
    );
  });

  it('sends prompt arguments and shows the rendered roles and messages', async () => {
    source.previewMcpForAnalysis.mockResolvedValue({
      kind: 'prompt',
      messages: [{ role: 'user', text: 'Review docs' }]
    });
    renderPage();
    await screen.findByText('fetch_docs');
    openTab('Prompts');
    fireEvent.click(screen.getByRole('button', { name: 'Preview review' }));
    fireEvent.change(screen.getByLabelText('topic (required)'), { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Render prompt' }));
    expect(await screen.findByText('Review docs')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByText('user')).toBeVisible();
    expect(source.previewMcpForAnalysis).toHaveBeenCalledWith(
      { kind: 'prompt', serverName: 'alpha', name: 'review', arguments: { topic: 'docs' } },
      expect.any(AbortSignal)
    );
  });

  it('discards stale discovery and shows unsupported capabilities for the selected server', async () => {
    let finishAlpha: (response: { servers: Array<typeof alpha> }) => void;
    source.discoverToolsForAnalysis.mockReturnValueOnce(
      new Promise((resolve) => {
        finishAlpha = resolve;
      })
    );
    source.discoverToolsForAnalysis.mockResolvedValueOnce({
      servers: [
        {
          ...alpha,
          serverName: 'beta',
          tools: [],
          catalog: {
            resources: { status: 'unsupported' },
            resourceTemplates: { status: 'unsupported' },
            prompts: { status: 'unsupported' }
          }
        }
      ]
    });
    renderPage();
    await waitFor(() => expect(source.discoverToolsForAnalysis).toHaveBeenCalledOnce());
    const alphaSignal = source.discoverToolsForAnalysis.mock.calls[0][1];
    fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
    openTab('Resources');
    expect(await screen.findByText('This server does not advertise resources.')).toBeVisible();
    await act(async () => finishAlpha({ servers: [alpha] }));
    expect(alphaSignal.aborted).toBe(true);
    expect(screen.getByText('This server does not advertise resources.')).toBeVisible();
    expect(screen.queryByText('Guide')).not.toBeInTheDocument();
    expect(source.discoverToolsForAnalysis).toHaveBeenLastCalledWith(
      { serverNames: ['beta'], includeCatalog: true },
      expect.any(AbortSignal)
    );
  });

  it('cancels a dismissed preview and only shows the current result when reopened', async () => {
    let finishFirst: (response: unknown) => void;
    source.previewMcpForAnalysis.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      })
    );
    source.previewMcpForAnalysis.mockResolvedValueOnce({
      kind: 'resource',
      contents: [{ uri: 'docs://guide', text: 'Current content' }]
    });
    renderPage();
    await screen.findByText('fetch_docs');
    openTab('Resources');
    const button = screen.getByRole('button', { name: 'Preview Guide' });
    fireEvent.click(button);
    await waitFor(() => expect(source.previewMcpForAnalysis).toHaveBeenCalledOnce());
    const signal = source.previewMcpForAnalysis.mock.calls[0][1];
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(signal.aborted).toBe(true);
    fireEvent.click(button);
    expect(await screen.findByText('Current content')).toBeVisible();
    await act(async () =>
      finishFirst({
        kind: 'resource',
        contents: [{ uri: 'docs://guide', text: 'Stale content' }]
      })
    );
    expect(screen.queryByText('Stale content')).not.toBeInTheDocument();
  });

  it('preserves selected tools for download and analysis after browsing prompts', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn(() => 'blob:tools');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      }
    );
    source.startToolAnalysis.mockResolvedValue({ jobId: 'test-job' });
    source.subscribeToolAnalysisJob.mockReturnValue(() => {});
    renderPage();
    await screen.findByText('fetch_docs');
    openTab('Prompts');
    openTab('Tools');
    expect(screen.getByRole('checkbox', { name: /fetch_docs/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Download Tool Info' }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Tools' }));
    expect(source.startToolAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        serverNames: ['alpha'],
        selectedToolsByServer: { alpha: ['fetch_docs'] }
      })
    );
    await waitFor(() =>
      expect(source.subscribeToolAnalysisJob).toHaveBeenCalledWith('test-job', expect.any(Function))
    );
  });
});
