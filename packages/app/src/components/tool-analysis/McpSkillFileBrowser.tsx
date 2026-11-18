import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { McpSkillFileEntry } from '@/lib/data-sources/types';
import { cn } from '@/lib/utils';
import { McpPreviewBody } from './McpPreview';
import {
  resourceInlinePreview,
  useMcpPreviewRequest,
  type LoadMcpPreview
} from './mcp-preview-state';

export function McpSkillFileBrowser({
  files,
  serverName,
  load
}: {
  files: McpSkillFileEntry[];
  serverName: string;
  load: LoadMcpPreview;
}) {
  const [selectedFile, setSelectedFile] = useState<McpSkillFileEntry>();
  const { state, loadPreview } = useMcpPreviewRequest(load);
  const readFile = ({ resource }: McpSkillFileEntry) => {
    if (!resource?.canRead) return;
    const { uri, via } = resource;
    void loadPreview({ kind: 'resource', serverName, uri, ...(via ? { via } : {}) });
  };
  const selectFile = (file: McpSkillFileEntry) => {
    if (file === selectedFile) return;
    setSelectedFile(file);
    readFile(file);
  };

  if (!files.length) return <p className="text-sm text-muted-foreground">No files listed.</p>;

  const resource = selectedFile?.resource;
  const returnedMimeType =
    state.status === 'ready' && state.response.kind === 'resource'
      ? state.response.contents.find(({ uri }) => uri === resource?.uri)?.mimeType
      : undefined;
  const mimeType = returnedMimeType ?? resource?.mimeType;
  const previewMode = resource ? resourceInlinePreview(resource.uri, mimeType) : undefined;

  return (
    <div className="grid min-w-0 rounded-md border lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
      <div className="min-w-0 border-b lg:border-r lg:border-b-0">
        <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </p>
        <ul
          aria-label="Files in manifest"
          className="max-h-72 divide-y overflow-y-auto lg:max-h-96"
        >
          {files.map((file, index) => {
            const { path, size } = file;
            const split = path.lastIndexOf('/') + 1;
            const fileName = path.slice(split) || path;
            const directory = split ? path.slice(0, split) : undefined;
            const label = (
              <>
                <FileText
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 space-y-1">
                  <code className="block wrap-anywhere">{fileName}</code>
                  {directory && (
                    <code className="block wrap-anywhere text-xs text-muted-foreground">
                      {directory}
                    </code>
                  )}
                  {path === 'SKILL.md' && <Badge variant="outline">Entry point</Badge>}
                  {!file.resource?.canRead && (
                    <span className="block text-xs text-muted-foreground">Preview unavailable</span>
                  )}
                </span>
                {size !== undefined && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {size.toLocaleString()} bytes
                  </span>
                )}
              </>
            );
            const rowClass =
              'flex min-h-11 w-full items-start gap-2 border-l-2 border-transparent px-3 py-2.5 text-left text-sm';
            return (
              <li key={`${path}:${index}`}>
                {file.resource?.canRead ? (
                  <button
                    type="button"
                    aria-label={path}
                    aria-pressed={selectedFile?.path === path}
                    className={cn(
                      rowClass,
                      'cursor-pointer hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:border-primary aria-pressed:bg-primary/8'
                    )}
                    onClick={() => selectFile(file)}
                  >
                    {label}
                  </button>
                ) : (
                  <div className={rowClass}>{label}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="min-w-0 p-3 sm:p-4">
        {selectedFile && resource ? (
          <McpPreviewBody
            key={resource.uri}
            state={state}
            inline={previewMode}
            heading={{
              title: <h4 className="wrap-anywhere text-sm font-medium">{selectedFile.path}</h4>,
              details: (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <code className="wrap-anywhere">{resource.uri}</code>
                    {mimeType && <span className="wrap-anywhere">{mimeType}</span>}
                  </div>
                  {selectedFile.digest && (
                    <code title="Advertised digest" className="block wrap-anywhere">
                      {selectedFile.digest}
                    </code>
                  )}
                </div>
              )
            }}
            listedResource={{ uri: resource.uri, mimeType }}
            onRetry={() => readFile(selectedFile)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Select a file to preview it.</p>
        )}
      </div>
    </div>
  );
}
