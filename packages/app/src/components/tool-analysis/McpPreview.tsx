import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ChevronRight } from 'lucide-react';
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
import type {
  McpPreviewRequest,
  McpPreviewResponse,
  McpPromptInfo
} from '@/lib/data-sources/types';

type PreviewTarget =
  | { kind: 'resource'; uri: string }
  | { kind: 'template'; uriTemplate: string }
  | { kind: 'prompt'; prompt: McpPromptInfo };

type PreviewState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: McpPreviewResponse };

export type LoadMcpPreview = (
  request: McpPreviewRequest,
  signal: AbortSignal
) => Promise<McpPreviewResponse>;

function PreviewResult({ response }: { response: McpPreviewResponse }) {
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
  return (
    <div className="space-y-3" aria-live="polite">
      {response.contents.length === 0 && (
        <p className="text-sm">The resource returned no content.</p>
      )}
      {response.contents.map((item, index) => (
        <div key={index} className="space-y-1">
          <p className="break-all font-mono text-xs">{item.uri}</p>
          {item.mimeType && <p className="text-xs text-muted-foreground">{item.mimeType}</p>}
          {typeof item.text === 'string' && <pre className={textStyle}>{item.text}</pre>}
          {item.blobBytes !== undefined && (
            <p className="text-sm">Binary content ({item.blobBytes.toLocaleString()} bytes)</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function McpPreview({
  title,
  serverName,
  target,
  load,
  via,
  inline = false
}: {
  title: string;
  serverName: string;
  target: PreviewTarget;
  load: LoadMcpPreview;
  via?: 'tool';
  inline?: boolean;
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
  const trigger = (
    <Button
      type="button"
      variant={inline ? 'ghost' : 'outline'}
      size="sm"
      className="group h-11 sm:h-8"
      aria-label={`Preview ${title}`}
    >
      {inline && (
        <ChevronRight
          aria-hidden="true"
          className="motion-safe:transition-transform group-data-[state=open]:rotate-90"
        />
      )}
      {inline ? 'Skill preview' : 'Preview'}
    </Button>
  );
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
      {state.status === 'ready' && <PreviewResult response={state.response} />}
    </>
  );

  if (inline) {
    return (
      <Collapsible onOpenChange={handleOpenChange}>
        <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>
        <CollapsibleContent className="min-w-0 space-y-3 rounded-md border p-3">
          {content}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
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
