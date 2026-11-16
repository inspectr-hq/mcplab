import { useState } from 'react';

const EXPANDABLE_DESCRIPTION_LENGTH = 120;

export function ToolDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const expandable = text.length > EXPANDABLE_DESCRIPTION_LENGTH;

  return (
    <div>
      <p className={`text-xs text-muted-foreground ${expandable && !expanded ? 'line-clamp-2' : ''}`}>
        {text}
      </p>
      {expandable && (
        <button
          type="button"
          className="mt-0.5 text-[11px] font-medium text-primary hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
