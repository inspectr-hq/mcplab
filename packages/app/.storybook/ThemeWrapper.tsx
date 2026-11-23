import { useEffect, type ReactNode } from 'react';

export function ThemeWrapper({ children, theme }: { children: ReactNode; theme: string }) {
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    return () => document.documentElement.classList.remove('dark');
  }, [theme]);

  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
