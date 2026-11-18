import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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

function mockClipboard() {
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  onTestFinished(() => {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });
  return writeText;
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

  it('uses the selected server name as the catalog heading', async () => {
    renderPage();
    await screen.findByText('fetch_docs');
    expect(screen.queryByRole('tab', { name: 'Skills' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Server catalog' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(screen.getByRole('heading', { name: 'Server catalog' })).toBeVisible();
  });

  it('groups the skill file and manifest on demand while keeping both entries in Resources', async () => {
    const uri = 'skill://work-organizer/SKILL.md';
    const manifestUri = 'skill://work-organizer/_manifest';
    const referenceUri = 'skill://work-organizer/references/search.md';
    const manifest = JSON.stringify({
      skill: 'work-organizer',
      files: [
        { path: 'SKILL.md', size: 42, hash: 'sha256:abc' },
        { path: 'references/search.md', size: 56, hash: 'sha256:def' }
      ]
    });
    source.discoverToolsForAnalysis.mockResolvedValueOnce({
      servers: [
        {
          ...alpha,
          catalog: {
            ...alpha.catalog,
            resources: {
              status: 'ready',
              items: [
                { name: 'work-organizer/SKILL.md', uri, description: 'Find saved work.' },
                { name: 'work-organizer/_manifest', uri: manifestUri },
                { name: 'references/search.md', uri: referenceUri, mimeType: 'text/markdown' }
              ]
            }
          }
        }
      ]
    });
    source.previewMcpForAnalysis.mockResolvedValueOnce({
      kind: 'resource',
      contents: [{ uri, text: '# Work Organizer' }]
    });
    source.previewMcpForAnalysis.mockResolvedValueOnce({
      kind: 'resource',
      contents: [{ uri: manifestUri, text: manifest }]
    });
    source.previewMcpForAnalysis.mockResolvedValueOnce({
      kind: 'resource',
      contents: [{ uri: referenceUri, mimeType: 'text/markdown', text: '# Search reference' }]
    });
    source.previewMcpForAnalysis.mockResolvedValueOnce({
      kind: 'resource',
      contents: [{ uri: referenceUri, mimeType: 'text/markdown', text: '# Search reference' }]
    });
    source.previewMcpForAnalysis.mockResolvedValueOnce({
      kind: 'resource',
      contents: [{ uri: manifestUri, text: manifest }]
    });
    renderPage();
    await screen.findByRole('tab', { name: 'Skills' });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Tools',
      'Skills',
      'Resources',
      'Prompts'
    ]);
    openTab('Skills');
    const skillsPanel = within(screen.getByRole('tabpanel', { name: 'Skills' }));
    expect(skillsPanel.getByRole('heading', { name: 'work-organizer' })).toBeVisible();
    expect(skillsPanel.getByText('Find saved work.')).toBeVisible();
    expect(source.previewMcpForAnalysis).not.toHaveBeenCalled();
    fireEvent.click(
      skillsPanel.getByRole('button', { name: 'Preview SKILL.md for work-organizer' })
    );
    expect(await skillsPanel.findByRole('heading', { name: 'Work Organizer' })).toBeVisible();
    expect(source.previewMcpForAnalysis).toHaveBeenCalledTimes(1);
    expect(source.previewMcpForAnalysis).toHaveBeenNthCalledWith(
      1,
      { kind: 'resource', serverName: 'alpha', uri },
      expect.any(AbortSignal)
    );
    fireEvent.click(skillsPanel.getByRole('button', { name: 'Browse files for work-organizer' }));
    const referenceFile = await skillsPanel.findByRole('button', {
      name: /references\/search\.md/
    });
    expect(skillsPanel.getByText('56 bytes')).toBeVisible();
    expect(source.previewMcpForAnalysis).toHaveBeenCalledTimes(2);
    expect(source.previewMcpForAnalysis).toHaveBeenNthCalledWith(
      2,
      { kind: 'resource', serverName: 'alpha', uri: manifestUri },
      expect.any(AbortSignal)
    );
    fireEvent.click(referenceFile);
    expect(await skillsPanel.findByRole('heading', { name: 'Search reference' })).toBeVisible();
    expect(skillsPanel.getByText('sha256:def')).toBeVisible();
    expect(source.previewMcpForAnalysis).toHaveBeenNthCalledWith(
      3,
      { kind: 'resource', serverName: 'alpha', uri: referenceUri },
      expect.any(AbortSignal)
    );
    fireEvent.click(
      within(skillsPanel.getByRole('group', { name: 'Manifest preview mode' })).getByRole(
        'button',
        { name: 'Raw' }
      )
    );
    expect(skillsPanel.getByText(manifest)).toBeVisible();
    expect(source.previewMcpForAnalysis).toHaveBeenCalledTimes(3);
    openTab('Resources');
    expect(screen.getByRole('checkbox', { name: 'work-organizer/SKILL.md' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'work-organizer/_manifest' })).toBeVisible();
    const referencePreview = screen.getByRole('button', { name: 'Preview references/search.md' });
    const manifestPreview = screen.getByRole('button', {
      name: 'Preview work-organizer/_manifest'
    });
    expect(referencePreview).toHaveAttribute('aria-expanded', 'false');
    expect(manifestPreview).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(referencePreview);
    const referenceRow = within(referencePreview.closest('li')!);
    expect(await referenceRow.findByRole('heading', { name: 'Search reference' })).toBeVisible();
    expect(referenceRow.getAllByText(referenceUri)).toHaveLength(1);
    expect(referenceRow.getAllByText('text/markdown')).toHaveLength(1);
    fireEvent.click(manifestPreview);
    expect(
      await within(manifestPreview.closest('li')!).findByRole('list', { name: 'Files in manifest' })
    ).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(source.previewMcpForAnalysis).toHaveBeenNthCalledWith(
      4,
      { kind: 'resource', serverName: 'alpha', uri: referenceUri },
      expect.any(AbortSignal)
    );
    expect(source.previewMcpForAnalysis).toHaveBeenNthCalledWith(
      5,
      { kind: 'resource', serverName: 'alpha', uri: manifestUri },
      expect.any(AbortSignal)
    );
    openTab('Skills');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(screen.queryByRole('tab', { name: 'Skills' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Resources' })).toHaveAttribute('aria-selected', 'true');
  });

  it('lists tool-backed resources explicitly and previews a skill file via its server tool', async () => {
    const writeText = mockClipboard();
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
              resources: [
                {
                  name: 'review',
                  uri: 'skill://review/SKILL.md',
                  description: 'Review MCP scenarios and results.'
                }
              ],
              resourceTemplates: [{ name: 'Page', uriTemplate: 'docs://pages/{id}' }]
            }
          }
        }
      ]
    });
    const skillSource = [
      '---',
      'name: review',
      'description: Review MCP scenarios and results.',
      '---',
      '',
      '# Review',
      '',
      '**Check** the trace.',
      '',
      '![Trace diagram](https://example.invalid/trace.png)'
    ].join('\r\n');
    source.previewMcpForAnalysis.mockResolvedValue({
      kind: 'resource',
      contents: [{ uri: 'skill://review/SKILL.md', text: skillSource }]
    });
    renderPage();
    await screen.findByText('fetch_docs');
    expect(source.discoverToolsForAnalysis).toHaveBeenCalledWith(
      { serverNames: ['alpha'], includeCatalog: true },
      expect.any(AbortSignal)
    );
    openTab('Resources');
    expect(screen.queryByRole('tab', { name: 'Skills' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'List via server tool' }));
    expect(await screen.findByText('Skill file')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Skills' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'review' })).toBeVisible();
    expect(screen.getByText('Review MCP scenarios and results.')).toBeVisible();
    expect(screen.getByText('docs://pages/{id}')).toBeVisible();
    expect(source.discoverToolsForAnalysis).toHaveBeenLastCalledWith(
      { serverNames: ['alpha'], includeCatalog: true, includeToolResources: true },
      expect.any(AbortSignal)
    );
    const preview = screen.getByRole('button', { name: 'Preview review' });
    expect(preview).toHaveAttribute('aria-expanded', 'false');
    expect(source.previewMcpForAnalysis).not.toHaveBeenCalled();
    fireEvent.click(preview);
    expect(preview).toHaveAttribute('aria-expanded', 'true');
    const row = preview.closest('li')!;
    const previewRow = within(row);
    expect(await previewRow.findByRole('heading', { name: 'Review' })).toBeVisible();
    expect(previewRow.getByRole('button', { name: 'Markdown' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(previewRow.queryByText(/name: review/)).not.toBeInTheDocument();
    expect(previewRow.getByText('Trace diagram')).toBeVisible();
    expect(previewRow.queryByRole('img')).not.toBeInTheDocument();
    const copy = previewRow.getByRole('button', { name: 'Copy raw Markdown' });
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(1, skillSource));
    fireEvent.click(previewRow.getByRole('button', { name: 'Raw' }));
    expect(row.querySelector('pre')?.textContent).toBe(skillSource);
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(2, skillSource));
    fireEvent.click(previewRow.getByRole('button', { name: 'Markdown' }));
    expect(previewRow.getByRole('heading', { name: 'Review' })).toBeVisible();
    expect(source.previewMcpForAnalysis).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(source.previewMcpForAnalysis).toHaveBeenCalledWith(
      { kind: 'resource', serverName: 'alpha', uri: 'skill://review/SKILL.md', via: 'tool' },
      expect.any(AbortSignal)
    );
    fireEvent.click(preview);
    expect(preview).toHaveAttribute('aria-expanded', 'false');
    expect(previewRow.queryByRole('heading', { name: 'Review' })).not.toBeInTheDocument();
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

  it('offers direct copy and download actions and preserves selection after browsing prompts', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn(() => 'blob:tools');
    const writeText = mockClipboard();
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
    fireEvent.click(screen.getByRole('button', { name: 'Copy tool list' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('fetch_docs'))
    );
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

  it('selects visible tools without clearing selections hidden by the filter', async () => {
    source.discoverToolsForAnalysis.mockResolvedValueOnce({
      servers: [{ ...alpha, tools: [...alpha.tools, { ...alpha.tools[0], name: 'search_pages' }] }]
    });
    renderPage();
    await screen.findByText('search_pages');
    fireEvent.click(screen.getByRole('checkbox', { name: 'search_pages' }));
    const filter = screen.getByRole('searchbox', { name: 'Filter tools' });
    fireEvent.change(filter, { target: { value: 'search' } });
    expect(screen.queryByText('fetch_docs')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select visible' }));
    fireEvent.change(filter, { target: { value: '' } });
    expect(screen.getByRole('checkbox', { name: 'fetch_docs' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'search_pages' })).toBeChecked();
  });

  it('offers selection, filtering, tokens and export actions for resources and prompts', async () => {
    const writeText = mockClipboard();
    const createObjectURL = vi.fn((_file: Blob) => 'blob:resources');
    const filenames: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      filenames.push(this.download);
    });
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      }
    );
    source.discoverToolsForAnalysis.mockResolvedValueOnce({
      servers: [
        {
          ...alpha,
          catalog: {
            resources: {
              status: 'ready',
              items: [{ name: 'Guide', uri: 'docs://guide', estimatedTokens: 12 }]
            },
            resourceTemplates: {
              status: 'ready',
              items: [{ name: 'Page', uriTemplate: 'docs://pages/{id}', estimatedTokens: 8 }]
            },
            prompts: { status: 'ready', items: [{ name: 'review', estimatedTokens: 5 }] }
          }
        }
      ]
    });
    renderPage();
    await screen.findByText('fetch_docs');
    openTab('Resources');
    expect(screen.getByText('2 of 2 selected')).toBeVisible();
    expect(screen.getByText('~20 tokens selected')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy resource list' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download Resource Info' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Guide' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter resources' }), {
      target: { value: 'pages/{id}' }
    });
    expect(screen.queryByRole('checkbox', { name: 'Guide' })).not.toBeInTheDocument();
    expect(screen.getByText('~8 tokens selected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Copy visible resource list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download Resource Info' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({
      serverName: 'alpha',
      resources: [],
      resourceTemplates: [{ name: 'Page', uriTemplate: 'docs://pages/{id}' }]
    });
    openTab('Prompts');
    expect(screen.getByRole('searchbox', { name: 'Filter prompts' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'review' })).toBeChecked();
    expect(screen.getByText('~5 tokens selected')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy prompt list' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download Prompt Info' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download Prompt Info' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(JSON.parse(writeText.mock.calls[1][0])).toEqual({
      serverName: 'alpha',
      prompts: [{ name: 'review' }]
    });
    expect(filenames).toEqual(['resource-info-alpha.json', 'prompt-info-alpha.json']);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    openTab('Resources');
    expect(screen.getByRole('searchbox', { name: 'Filter resources' })).toHaveValue('pages/{id}');
    expect(screen.getByText('1 of 2 selected')).toBeVisible();
  });
});
