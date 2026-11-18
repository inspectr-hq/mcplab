import { toast } from '@/hooks/use-toast';

export async function copyTextToClipboard(label: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  } catch (error: unknown) {
    toast({
      title: `Could not copy ${label.toLowerCase()}`,
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    });
  }
}
