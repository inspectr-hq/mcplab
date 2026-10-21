import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

export function ToolAlternativesEditor({
  value,
  onChange,
  onValidityChange,
  availableTools,
  label,
  onEnter
}: {
  value: string;
  onChange: (value: string) => void;
  onValidityChange?: (invalid: boolean) => void;
  availableTools?: string[] | null;
  label: string;
  onEnter?: () => void;
}) {
  const alternatives = value.split('|');
  const [pipeError, setPipeError] = useState(false);
  const duplicate = alternatives.some(
    (tool, index) =>
      tool.trim() && alternatives.findIndex((name) => name.trim() === tool.trim()) !== index
  );
  const invalid = alternatives.some((tool) => !tool.trim() || tool.includes('|')) || duplicate;
  const update = (index: number, tool: string) => {
    if (tool.includes('|')) {
      setPipeError(true);
      onValidityChange?.(true);
      return;
    }
    setPipeError(false);
    onValidityChange?.(false);
    onChange(alternatives.map((current, i) => (i === index ? tool : current)).join('|'));
  };
  return (
    <div className="min-w-0 flex-1 space-y-1.5" aria-label={label}>
      {alternatives.map((tool, index) => (
        <div key={`${index}-${alternatives.length}`} className="flex flex-wrap items-center gap-2">
          <Input
            value={tool}
            onChange={(event) => update(index, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && onEnter) {
                event.preventDefault();
                onEnter();
              }
            }}
            placeholder="Tool name"
            aria-label={`${label} ${index + 1}`}
            className="h-8 min-w-32 flex-1 text-xs font-mono"
          />
          {availableTools?.length ? (
            <Select
              value={availableTools.includes(tool) ? tool : ''}
              onValueChange={(next) => update(index, next)}
            >
              <SelectTrigger className="h-8 w-48 max-w-full text-xs font-mono">
                <SelectValue placeholder="Pick discovered tool" />
              </SelectTrigger>
              <SelectContent>
                {availableTools.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {alternatives.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Remove ${tool || `alternative ${index + 1}`}`}
              onClick={() => {
                setPipeError(false);
                onValidityChange?.(false);
                onChange(alternatives.filter((_, i) => i !== index).join('|'));
              }}
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
        onClick={() => onChange([...alternatives, ''].join('|'))}
      >
        Add alternative
      </Button>
      {pipeError && (
        <p className="text-xs text-destructive" role="alert">
          Enter one exact tool name per field. Use Add alternative to add another.
        </p>
      )}
      {duplicate && (
        <p className="text-xs text-destructive" role="alert">
          Tool already added.
        </p>
      )}
      {!pipeError && !duplicate && invalid && (
        <p className="text-xs text-destructive" role="alert">
          Enter one exact tool name per alternative.
        </p>
      )}
    </div>
  );
}
