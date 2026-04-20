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
    <div className='mx-auto mb-10 mt-6 max-w-3xl text-center'>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='mx-auto mt-8 flex w-full max-w-2xl items-center justify-between rounded-full border border-border bg-card px-5 py-4 text-left shadow-sm transition-colors hover:bg-accent/30'
        aria-label='Open docs search'
      >
        <span className='flex items-center gap-3 text-muted-foreground'>
          <Search className='h-5 w-5' />
          <span className='text-lg'>Search docs</span>
        </span>
        <kbd className='inline-flex h-6 items-center rounded-md border border-border bg-muted px-2 font-mono text-[11px] text-muted-foreground'>
          ⌘K
        </kbd>
      </button>

      <DocsSearch open={open} onOpenChange={setOpen} pages={pages} />
    </div>
  );
};

export default DocsSearchHero;
