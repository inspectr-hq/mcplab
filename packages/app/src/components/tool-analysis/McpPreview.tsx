import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronRight, Copy } from 'lucide-react';
import { MarkdownContent } from '@/components/MarkdownContent';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { copyTextToClipboard } from '@/lib/copy-text-to-clipboard';
import { parseMcpSkillManifest } from '@/lib/data-sources/types';
import type {
  McpPreviewRequest,
  McpPreviewResponse,
  McpPromptInfo,
  McpResourceInfo,
  McpSkillManifestFile
} from '@/lib/data-sources/types';

type PreviewTarget =
  | { kind: 'resource'; uri: string }
  | { kind: 'template'; uriTemplate: string }
  | { kind: 'prompt'; prompt: McpPromptInfo };

type PreviewState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: McpPreviewResponse };

type ResourceMetadata = Pick<McpResourceInfo, 'uri' | 'mimeType'>;

export type InlinePreview = 'skill' | 'manifest' | 'markdown' | 'raw';

export type LoadMcpPreview = (
  request: McpPreviewRequest,
  signal: AbortSignal
) => Promise<McpPreviewResponse>;

function skillMarkdownBody(text: string): string {
  return text.replace(
    /^\uFEFF?---[ \t]*\r?\n(?:[^\r\n]*\r?\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/,
    ''
  );
}

function ManifestFiles({ files }: { files: McpSkillManifestFile[] }) {
  if (!files.length) return <p className="text-sm text-muted-foreground">No files listed.</p>;
  return (
    <ul aria-label="Files in manifest" className="divide-y rounded-md border">
      {files.map(({ path, size, digest }, index) => (
        <li key={`${path}:${index}`} className="space-y-1 px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <code className="min-w-0 wrap-anywhere">{path}</code>
            {size !== undefined && (
              <span className="text-xs text-muted-foreground">{size.toLocaleString()} bytes</span>
            )}
          </div>
          {digest && (
            <code title="Digest" className="block wrap-anywhere text-xs text-muted-foreground">
              {digest}
            </code>
          )}
        </li>
      ))}
    </ul>
  );
}

function PreviewResult({
  response,
  inline,
  listedResource
}: {
  response: McpPreviewResponse;
  inline?: InlinePreview;
  listedResource?: ResourceMetadata;
}) {
  const [raw, setRaw] = useState(false);
  const textStyle = 'whitespace-pre-wrap wrap-anywhere rounded bg-muted p-3 text-sm';
  if (response.kind === 'prompt') {
    return (
      <div className="space-y-3" aria-live="polite">
        {response.description && (
          <p className="text-sm text-muted-foreground">{response.description}</p>
        )}
        {response.messages.length === 0 && (
          <p className="text-sm">The prompt returned no messages.</p>
        )}
        {response.messages.map((message, index) => (
          <div key={index} className="space-y-1">
            <p className="text-sm font-medium">{message.role}</p>
            <pre className={textStyle}>{message.text}</pre>
          </div>
        ))}
      </div>
    );
  }
  const contents = response.contents.map((item) => ({
    item,
    manifest:
      inline === 'manifest' && typeof item.text === 'string'
        ? parseMcpSkillManifest(item.text)
        : null
  }));
  const markdown = inline === 'skill' || inline === 'markdown';
  const markdownParts = markdown
    ? contents.flatMap(({ item }) => (typeof item.text === 'string' ? [item.text] : []))
    : [];
  const canFormat = markdownParts.length > 0 || contents.some(({ manifest }) => manifest !== null);
  const modes = [
    { label: inline === 'manifest' ? 'Files' : 'Markdown', raw: false },
    { label: 'Raw', raw: true }
  ];
  let modeLabel = 'Preview mode';
  if (inline === 'manifest') modeLabel = 'Manifest preview mode';
  if (inline === 'skill') modeLabel = 'Skill preview mode';
  return (
    <div className="space-y-3" aria-live="polite">
      {canFormat && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b pb-2">
          <div
            role="group"
            aria-label={modeLabel}
            className="inline-flex gap-0.5 rounded-md border p-0.5"
          >
            {modes.map((mode) => (
              <Button
                key={mode.label}
                type="button"
                size="sm"
                variant={raw === mode.raw ? 'secondary' : 'ghost'}
                className="h-11 px-2 sm:h-8 sm:px-3"
                aria-pressed={raw === mode.raw}
                onClick={() => setRaw(mode.raw)}
              >
                {mode.label}
              </Button>
            ))}
          </div>
          {markdownParts.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 bg-transparent px-2 sm:h-8 sm:px-3"
              aria-label="Copy raw Markdown"
              onClick={() => void copyTextToClipboard('Raw Markdown', markdownParts.join('\n\n'))}
            >
              <Copy aria-hidden="true" />
              Copy
            </Button>
          )}
        </div>
      )}
      {response.contents.length === 0 && (
        <p className="text-sm">The resource returned no content.</p>
      )}
      {contents.map(({ item, manifest }, index) => {
        const showUri = contents.length > 1 || item.uri !== listedResource?.uri;
        const showMimeType =
          item.mimeType && (showUri || item.mimeType !== listedResource?.mimeType);
        let textPreview: ReactNode = null;
        if (typeof item.text === 'string') {
          if (!raw && manifest) textPreview = <ManifestFiles files={manifest} />;
          else if (!raw && markdown) {
            textPreview = (
              <MarkdownContent
                text={inline === 'skill' ? skillMarkdownBody(item.text) : item.text}
                renderImages={false}
                className="min-w-0 wrap-anywhere text-sm"
              />
            );
          } else textPreview = <pre className={textStyle}>{item.text}</pre>;
        }
        return (
          <div key={index} className="space-y-1">
            {showUri && <p className="wrap-anywhere font-mono text-xs">{item.uri}</p>}
            {showMimeType && (
              <p className="wrap-anywhere text-xs text-muted-foreground">{item.mimeType}</p>
            )}
            {textPreview}
            {item.blobBytes !== undefined && (
              <p className="text-sm">Binary content ({item.blobBytes.toLocaleString()} bytes)</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function McpPreview({
  title,
  serverName,
  target,
  load,
  via,
  inline,
  listedResource,
  renderTrigger
}: {
  title: string;
  serverName: string;
  target: PreviewTarget;
  load: LoadMcpPreview;
  via?: 'tool';
  inline?: InlinePreview;
  listedResource?: ResourceMetadata;
  renderTrigger?: (trigger: ReactNode) => ReactNode;
}) {
  const id = useId();
  const [state, setState] = useState<PreviewState>({ status: 'idle' });
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

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

  const readResource = (uri: string) =>
    loadPreview({ kind: 'resource', serverName, uri, ...(via ? { via } : {}) });
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      active.current?.abort();
      setState({ status: 'idle' });
    } else if (target.kind === 'resource') {
      void readResource(target.uri);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (target.kind === 'template') {
      const uri = String(values.get('uri') ?? '').trim();
      if (uri) void readResource(uri);
    } else if (target.kind === 'prompt') {
      const args = Object.fromEntries(
        Array.from(values, ([name, value]) => [name, String(value)]).filter(
          ([, value]) => value !== ''
        )
      );
      void loadPreview({ kind: 'prompt', serverName, name: target.prompt.name, arguments: args });
    }
  };

  const loading = state.status === 'loading';
  const args = target.kind === 'prompt' ? (target.prompt.arguments ?? []) : [];
  let detail: string;
  if (target.kind === 'template') detail = target.uriTemplate;
  else if (target.kind === 'resource') detail = target.uri;
  else detail = target.prompt.name;
  let triggerLabel = 'Preview';
  if (!renderTrigger && inline === 'skill') triggerLabel = 'Skill preview';
  if (!renderTrigger && inline === 'manifest') triggerLabel = 'Manifest';
  const trigger = (
    <Button
      type="button"
      variant={inline && !renderTrigger ? 'ghost' : 'outline'}
      size="sm"
      className="group h-11 sm:h-8"
      aria-label={`Preview ${title}`}
    >
      {triggerLabel}
      {inline && (
        <ChevronRight
          aria-hidden="true"
          className="motion-safe:transition-transform group-data-[state=open]:rotate-90"
        />
      )}
    </Button>
  );
  const placeTrigger = renderTrigger ?? ((trigger: ReactNode) => trigger);
  const content = (
    <>
      {target.kind !== 'resource' && (
        <form className="space-y-3" onSubmit={submit}>
          {target.kind === 'template' && (
            <div className="space-y-1">
              <Label htmlFor={`${id}-uri`}>Resource URI</Label>
              <Input id={`${id}-uri`} name="uri" type="url" required disabled={loading} />
              <p className="text-xs text-muted-foreground">
                Enter a concrete URI for the template.
              </p>
            </div>
          )}
          {args.map((argument, index) => {
            const fieldId = `${id}-${index}`;
            const descriptionId = argument.description ? `${fieldId}-description` : undefined;
            return (
              <div key={argument.name} className="space-y-1">
                <Label htmlFor={fieldId} className="wrap-anywhere">
                  {argument.name} ({argument.required ? 'required' : 'optional'})
                </Label>
                <Textarea
                  id={fieldId}
                  name={argument.name}
                  rows={2}
                  required={argument.required}
                  disabled={loading}
                  aria-describedby={descriptionId}
                />
                {argument.description && (
                  <p id={descriptionId} className="text-xs text-muted-foreground">
                    {argument.description}
                  </p>
                )}
              </div>
            );
          })}
          <Button type="submit" size="sm" disabled={loading}>
            {target.kind === 'template' ? 'Read resource' : 'Render prompt'}
          </Button>
        </form>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading preview…
        </p>
      )}
      {state.status === 'error' && (
        <div className="space-y-2">
          <p role="alert" className="wrap-anywhere text-sm text-destructive">
            {state.message}
          </p>
          {target.kind === 'resource' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void readResource(target.uri)}
            >
              Retry preview
            </Button>
          )}
        </div>
      )}
      {state.status === 'ready' && (
        <PreviewResult
          response={state.response}
          inline={inline}
          listedResource={inline ? listedResource : undefined}
        />
      )}
    </>
  );

  if (inline) {
    return (
      <Collapsible className="space-y-3" onOpenChange={handleOpenChange}>
        {placeTrigger(<CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>)}
        <CollapsibleContent className="min-w-0 space-y-3 rounded-md border p-3">
          {content}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
      {placeTrigger(<DialogTrigger asChild>{trigger}</DialogTrigger>)}
      <DialogContent className="max-h-[85dvh] w-11/12 overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-5">
          <DialogTitle className="wrap-anywhere">{title}</DialogTitle>
          <DialogDescription className="break-all font-mono">{detail}</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
