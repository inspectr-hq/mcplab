import React from 'react';
import { useEffect } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { FileText } from 'lucide-react';
import type { DocNavItem } from '@/data/docs';

interface DocsSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: DocNavItem[];
}

const DocsSearch = ({ open, onOpenChange, pages }: DocsSearchProps) => {
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  const handleSelect = (href: string) => {
    onOpenChange(false);
    window.location.href = href;
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder='Search docs…' />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading='Documentation'>
          {pages.map((page) => (
            <CommandItem
              key={page.href}
              value={`${page.label} ${page.description} ${(page.keywords ?? []).join(' ')}`}
              onSelect={() => handleSelect(page.href)}
              className='flex items-start gap-3 py-3 cursor-pointer'
            >
              <FileText className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
              <div className='flex flex-col'>
                <span className='text-sm font-medium'>{page.label}</span>
                <span className='text-xs text-muted-foreground'>{page.description}</span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

export default DocsSearch;
