import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Prism from '@/lib/prism-setup';

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

function inferLanguage(title?: string, code?: string): string {
  if (title) {
    const normalized = title.toLowerCase();
    if (normalized === 'terminal' || normalized === 'cli' || normalized === 'sh' || normalized === 'shell') {
      return 'bash';
    }
    if (normalized.endsWith('.js')) return 'javascript';
    if (normalized.endsWith('.ts')) return 'typescript';
    if (normalized.endsWith('.json')) return 'json';
    if (normalized.endsWith('.yaml') || normalized.endsWith('.yml')) return 'yaml';
    if (normalized === 'npm' || normalized === 'yarn') return 'bash';
  }

  if (code) {
    const trimmed = code.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    if (trimmed.startsWith('$') || code.includes('npx ') || code.includes('npm ') || code.includes('mcplab ')) {
      return 'bash';
    }
  }

  return 'yaml';
}

const CodeBlock = ({ code, language, title }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const langMap: Record<string, string> = {
    sh: 'bash',
    shell: 'bash',
    terminal: 'bash',
    js: 'javascript',
    ts: 'typescript',
  };

  const baseLanguage = language
    ? (langMap[language.toLowerCase()] ?? language.toLowerCase())
    : inferLanguage(title, code);

  const resolvedLanguage =
    baseLanguage === 'bash' && (code.includes('mcplab ') || code.includes('@inspectr/mcplab'))
      ? 'mcplab'
      : baseLanguage;

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code, resolvedLanguage]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-5">
      <div className="overflow-hidden rounded-xl border border-border bg-muted/25 shadow-sm">
        {title ? (
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span>{title}</span>
            <button
              onClick={copy}
              className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Copy code"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : null}
        <div className="relative">
          {!title ? (
            <button
              onClick={copy}
              className="absolute right-3 top-3 z-10 inline-flex items-center justify-center rounded-md bg-background/70 p-1.5 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
              aria-label="Copy code"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          ) : null}
          <pre
            tabIndex={0}
            className={`m-0 overflow-x-auto bg-transparent p-4 text-sm leading-relaxed language-${resolvedLanguage}`}
          >
            <code ref={codeRef} className={`language-${resolvedLanguage}`}>
              {code}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
};

export default CodeBlock;
