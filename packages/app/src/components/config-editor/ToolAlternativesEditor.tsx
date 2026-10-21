import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatToolAlternatives, isValidToolExpression } from '@/types/eval';

function ToolAlternativeOrBadge() {
  return (
    <span className="rounded border bg-muted px-1 text-[9px] font-semibold leading-3 text-muted-foreground">
      OR
    </span>
  );
}

export function ToolAlternativesDisplay({
  value,
  className = ''
}: {
  value: string;
  className?: string;
}) {
  const displayClassName = `inline-flex flex-wrap items-center gap-x-1 font-mono break-all ${className}`;
  if (!isValidToolExpression(value)) {
    return <span className={displayClassName}>{formatToolAlternatives(value)}</span>;
  }

  const alternatives = value.split('|').map((name) => name.trim());
  return (
    <span className={displayClassName}>
      {alternatives.map((name, index) => (
        <span key={`${index}-${name}`} className="inline-flex items-center gap-1">
          {index > 0 && <ToolAlternativeOrBadge />}
          {name}
        </span>
      ))}
    </span>
  );
}

export function ToolSequenceDisplay({
  sequence,
  className = ''
}: {
  sequence: string[];
  className?: string;
}) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 break-all ${className}`}>
      {sequence.map((step, index) => (
        <span key={`${index}-${step}`} className="inline-flex items-center gap-x-1">
          {index > 0 && <span className="text-muted-foreground">-&gt;</span>}
          <ToolAlternativesDisplay value={step} />
        </span>
      ))}
    </span>
  );
}

/** Edits a `search|lookup` tool expression as one input per alternative. */
export function ToolAlternativesEditor({
  value,
  onChange,
  onEnter,
  label
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  label: string;
}) {
  const alternatives = value.split('|');
  const names = alternatives.map((name) => name.trim()).filter(Boolean);
  const duplicate = new Set(names).size !== names.length;
  const setAlternatives = (next: string[]) => onChange(next.join('|'));
  return (
    <div className="min-w-0 flex-1" aria-label={label}>
      {alternatives.map((tool, index) => (
        <div key={index}>
          <div className="flex items-center gap-2">
            <Input
              value={tool}
              onChange={(e) =>
                setAlternatives(
                  alternatives.map((current, i) =>
                    i === index ? e.target.value.replaceAll('|', '') : current
                  )
                )
              }
              onKeyDown={(e) => e.key === 'Enter' && onEnter && (e.preventDefault(), onEnter())}
              placeholder="Tool name"
              aria-label={`${label} ${index + 1}`}
              className="h-8 text-xs font-mono"
            />
            {alternatives.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={`Remove ${tool || `alternative ${index + 1}`}`}
                onClick={() => setAlternatives(alternatives.filter((_, i) => i !== index))}
              >
                ×
              </Button>
            )}
          </div>
          {index < alternatives.length - 1 && (
            <div className="relative z-10 -my-1.5 flex justify-center">
              <ToolAlternativeOrBadge />
            </div>
          )}
        </div>
      ))}
      {duplicate && (
        <p className="text-xs text-destructive" role="alert">
          Tool already added.
        </p>
      )}
    </div>
  );
}

export function AddToolAlternativeButton({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 shrink-0"
      onClick={() => onChange([...value.split('|'), ''].join('|'))}
    >
      OR
    </Button>
  );
}
