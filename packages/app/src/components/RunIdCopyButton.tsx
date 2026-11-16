import { CopyButton } from '@/components/CopyButton';

export function RunIdCopyButton({ runId }: { runId: string }) {
  return (
    <CopyButton
      text={runId}
      label="Run ID"
      iconOnly
      showCheckmarkOnCopy
      className="h-4 w-4 cursor-pointer p-0 text-muted-foreground hover:bg-transparent hover:text-muted-foreground [&_svg]:h-4 [&_svg]:w-4"
    />
  );
}
