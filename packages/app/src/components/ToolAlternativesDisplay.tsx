import { isValidToolExpression, parseToolAlternatives } from '@/types/eval';

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
    return <span className={displayClassName}>{value}</span>;
  }

  const alternatives = parseToolAlternatives(value);
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
