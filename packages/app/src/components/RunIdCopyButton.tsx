import { CopyButton } from '@/components/CopyButton';

export function RunIdCopyButton({ runId, iconSize = 2 }: { runId: string; iconSize?: 2 | 4 }) {
  const iconSizeClass =
    iconSize === 4 ? '[&_svg]:h-4 [&_svg]:w-4' : '[&_svg]:h-2 [&_svg]:w-2';

  return (
    <CopyButton
      text={runId}
      label="Run ID"
      iconOnly
      showCheckmarkOnCopy
      className={`h-4 w-4 cursor-pointer p-0 text-muted-foreground hover:bg-transparent hover:text-muted-foreground ${iconSizeClass}`}
    />
  );
}
