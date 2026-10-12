export function QueueProcessingIndicator({ label = 'Queue processing' }: { label?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent motion-reduce:animate-none"
    />
  );
}
