import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ToolAlternativeOrBadge,
  ToolAlternativesDisplay
} from '@/components/ToolAlternativesDisplay';
import { ToolNameInput, type ToolNameInputProps } from '@/components/config-editor/ToolNameInput';

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
  label,
  toolSuggestions
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  label: string;
  toolSuggestions?: Omit<ToolNameInputProps, 'value' | 'onChange' | 'onEnter' | 'inputLabel'>;
}) {
  const alternatives = value.split('|');
  const names = alternatives.map((name) => name.trim()).filter(Boolean);
  const duplicate = new Set(names).size !== names.length;
  const setAlternatives = (next: string[]) => onChange(next.join('|'));
  const updateAlternative = (index: number, name: string) => {
    const replacements = name.includes('|')
      ? name.split('|').map((alternative) => alternative.trim())
      : [name];
    setAlternatives(
      alternatives.flatMap((current, currentIndex) =>
        currentIndex === index ? replacements : [current]
      )
    );
  };
  return (
    <div className="min-w-0 flex-1" aria-label={label}>
      {alternatives.map((tool, index) => (
        <div key={index}>
          <div className="flex items-center gap-2">
            {toolSuggestions ? (
              <ToolNameInput
                {...toolSuggestions}
                value={tool}
                onChange={(name) => updateAlternative(index, name)}
                onEnter={onEnter}
                inputLabel={`${label} ${index + 1}`}
              />
            ) : (
              <Input
                value={tool}
                onChange={(event) => updateAlternative(index, event.target.value)}
                onKeyDown={(event) =>
                  event.key === 'Enter' && onEnter && (event.preventDefault(), onEnter())
                }
                placeholder="Tool name"
                aria-label={`${label} ${index + 1}`}
                className="h-8 text-xs font-mono"
              />
            )}
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
