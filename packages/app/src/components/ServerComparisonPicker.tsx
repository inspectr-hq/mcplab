import { McpServerPicker } from '@/components/McpServerPicker';

export function ServerComparisonPicker({
  selectedIds,
  servers,
  onChange
}: {
  selectedIds: string[];
  servers: Array<{ id: string; name?: string }>;
  onChange: (ids: string[]) => void;
}) {
  return (
    <div
      role="group"
      aria-label="MCP servers to compare"
      aria-describedby="server-comparison-help"
      className="space-y-3"
    >
      <p id="server-comparison-help" className="text-sm text-muted-foreground">
        Run each selected test separately against each server.
      </p>
      <McpServerPicker servers={servers} selectedIds={selectedIds} onChange={onChange} />
      {servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No MCP servers are available for this evaluation.
        </p>
      ) : (
        selectedIds.length < 2 && (
          <p className="text-sm text-muted-foreground">
            Select at least two MCP servers to compare.
          </p>
        )
      )}
    </div>
  );
}
