export function formatAssistantToolName(name: string | null | undefined): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "unknown_tool";
  const scoped = raw.split("::").pop() ?? raw;
  const stripped = scoped.replace(/^mcplab__/, "").replace(/^mcplab_/, "");
  return stripped.replace(/_/g, " ").replace(/\s+/g, " ").trim() || "unknown_tool";
}
