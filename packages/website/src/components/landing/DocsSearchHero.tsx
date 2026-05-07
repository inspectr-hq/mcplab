import React from 'react';
import { useState } from 'react';
import { Search } from 'lucide-react';
import DocsSearch from '@/components/docs/DocsSearch';
import type { DocNavItem } from '@/data/docs';

interface DocsSearchHeroProps {
  pages: DocNavItem[];
}

const DocsSearchHero = ({ pages }: DocsSearchHeroProps) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto mb-10 mt-6 max-w-3xl text-center">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto mt-6 flex w-full max-w-xl items-center justify-between rounded-full border border-border bg-card px-4 py-2.5 text-left shadow-sm transition-colors hover:bg-accent/30"
        aria-label="Open docs search"
      >
        <span className="flex items-center gap-3 text-muted-foreground">
          <Search className="h-4 w-4" />
          <span className="text-base">Search docs</span>
        </span>
        <kbd className="inline-flex h-5 items-center rounded-md border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <DocsSearch open={open} onOpenChange={setOpen} pages={pages} />
    </div>
  );
};

export default DocsSearchHero;
