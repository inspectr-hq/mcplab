import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * Markdown from assistants, reports and run transcripts. GitHub-flavoured markdown (nested
 * lists, tables, task lists, strikethrough); raw HTML is shown as text, never rendered.
 */
export function MarkdownContent({
  text,
  variant = 'assistant',
  className
}: {
  text: string;
  variant?: 'assistant' | 'system';
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', variant === 'system' && 'text-xs', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={variant === 'system' ? systemComponents : components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const heading = (className: string): Components['h1'] =>
  function Heading({ node: _node, ...props }) {
    return <h4 className={className} {...props} />;
  };

const components: Components = {
  h1: heading('text-base font-semibold'),
  h2: heading('text-sm font-semibold'),
  h3: heading('text-sm font-medium'),
  h4: heading('text-sm font-medium'),
  h5: heading('text-sm font-medium'),
  h6: heading('text-sm font-medium'),
  // Models often break lines with a single newline; keep those breaks visible.
  p: ({ node: _node, ...props }) => (
    <p className="whitespace-pre-wrap leading-relaxed" {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="list-disc space-y-1 pl-5 [&_ul]:mt-1 [&_ul]:list-[circle]" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="list-decimal space-y-1 pl-5 [&_ol]:mt-1" {...props} />
  ),
  li: ({ node: _node, ...props }) => (
    <li className="leading-relaxed [&>p]:whitespace-normal [&_ol]:mt-1 [&_ul]:mt-1" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground italic"
      {...props}
    />
  ),
  hr: () => <hr className="border-border/60" />,
  a: ({ node: _node, ...props }) => (
    <a target="_blank" rel="noreferrer" className="underline underline-offset-2" {...props} />
  ),
  code: ({ node: _node, className, ...props }) => (
    <code
      className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]', className)}
      {...props}
    />
  ),
  pre: ({ node, children }) => {
    const language = codeLanguage(node);
    return (
      <div className="rounded-md border bg-muted/70">
        {language && (
          <div className="border-b px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {language}
          </div>
        )}
        <pre className="max-h-72 overflow-auto p-2 text-xs [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-xs">
          {children}
        </pre>
      </div>
    );
  },
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[480px] border-collapse text-xs" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="bg-muted/40" {...props} />,
  tr: ({ node: _node, ...props }) => <tr className="border-t first:border-t-0" {...props} />,
  th: ({ node: _node, ...props }) => (
    <th className="border-b px-2 py-1.5 text-left font-semibold align-top" {...props} />
  ),
  td: ({ node: _node, ...props }) => <td className="px-2 py-1.5 align-top" {...props} />,
  img: ({ node: _node, alt, ...props }) => (
    <img alt={alt ?? ''} className="max-w-full rounded" {...props} />
  )
};

const systemComponents: Components = {
  ...components,
  p: ({ node: _node, ...props }) => <p className="whitespace-pre-wrap leading-normal" {...props} />
};

/** The language of a fenced code block, from its `language-*` class. */
function codeLanguage(node: ExtraProps['node']) {
  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
  const classes = code?.type === 'element' ? code.properties.className : undefined;
  const language = (Array.isArray(classes) ? classes : [])
    .map(String)
    .find((name) => name.startsWith('language-'));
  return language?.slice('language-'.length);
}
