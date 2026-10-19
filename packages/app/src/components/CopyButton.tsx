import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export function CopyButton({
  text,
  label,
  iconOnly = false,
  className
}: {
  text: string;
  label: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: 'Copied', description: `${label} copied to clipboard.` });
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error: unknown) {
      toast({
        title: 'Copy failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    }
  };

  return (
    <Button
      type="button"
      size={iconOnly ? 'icon' : 'sm'}
      variant={iconOnly ? 'ghost' : 'outline'}
      className={cn(iconOnly && 'h-7 w-7 shrink-0', className)}
      disabled={!text}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => void handleCopy()}
    >
      <Copy className={iconOnly ? 'h-3.5 w-3.5' : 'mr-2 h-3.5 w-3.5'} />
      {!iconOnly && (copied ? 'Copied' : 'Copy')}
    </Button>
  );
}
