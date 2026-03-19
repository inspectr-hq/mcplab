import { useEffect, useState } from 'react';
import { Menu, X, Search, Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DocsSearch from '@/components/docs/DocsSearch';
import type { DocNavItem } from '@/data/docs';
import SiteBrand from '@/components/shared/SiteBrand';

interface DocsHeaderProps {
  pages: DocNavItem[];
}

const DocsHeader = ({ pages }: DocsHeaderProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleClose = () => setSidebarOpen(false);
    document.addEventListener('docs-sidebar-close', handleClose as EventListener);
    return () => document.removeEventListener('docs-sidebar-close', handleClose as EventListener);
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
    document.getElementById('docs-sidebar-mobile')?.classList.toggle('hidden');
    document.getElementById('docs-sidebar-backdrop')?.classList.toggle('hidden');
  };

  return (
    <>
      <header className='sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-sm'>
        <div className='mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-10'>
          <div className='flex items-center gap-3 min-w-0'>
            <Button variant='ghost' size='icon' className='lg:hidden' onClick={toggleSidebar} aria-label='Toggle sidebar'>
              {sidebarOpen ? <X className='h-5 w-5' /> : <Menu className='h-5 w-5' />}
            </Button>
            <SiteBrand href='/' compact showInspectr={false} />
            <span className='hidden sm:inline text-sm text-muted-foreground'>/ docs</span>
          </div>

          <div className='flex items-center gap-1 shrink-0'>
            <Button
              variant='outline'
              size='sm'
              className='hidden sm:inline-flex gap-2 text-sm h-8 px-3 text-muted-foreground'
              onClick={() => setSearchOpen(true)}
            >
              <Search className='h-3.5 w-3.5' />
              Search docs…
              <kbd className='ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground'>
                ⌘K
              </kbd>
            </Button>
            <Button variant='ghost' size='icon' className='sm:hidden' onClick={() => setSearchOpen(true)} aria-label='Search docs'>
              <Search className='h-4 w-4' />
            </Button>
            <a href='https://github.com/inspectr-hq/mcplab' target='_blank' rel='noreferrer noopener'>
              <Button variant='ghost' size='icon' aria-label='GitHub'>
                <Github className='h-4 w-4' />
              </Button>
            </a>
          </div>
        </div>
      </header>

      <DocsSearch open={searchOpen} onOpenChange={setSearchOpen} pages={pages} />
    </>
  );
};

export default DocsHeader;
