import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <div className="min-w-0 flex-1 space-y-1.5" aria-label={label}>
      {alternatives.map((tool, index) => (
        <div key={index} className="flex items-center gap-2">
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
          {index < alternatives.length - 1 && (
            <span className="text-xs text-muted-foreground">OR</span>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7"
        onClick={() => setAlternatives([...alternatives, ''])}
      >
        Add alternative
      </Button>
      {duplicate && (
        <p className="text-xs text-destructive" role="alert">
          Tool already added.
        </p>
      )}
    </div>
  );
}
