import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ServerConfig } from "@/types/eval";

interface ServerFormProps {
  servers: ServerConfig[];
  onChange: (servers: ServerConfig[]) => void;
  readOnly?: boolean;
  allowAdd?: boolean;
  allowStructureEdits?: boolean;
  showHeader?: boolean;
}

const emptyServer = (): ServerConfig => ({
  id: `srv-${Date.now()}`,
  name: "",
  transport: "stdio",
  authType: "none",
  oauthRedirectUrl: "http://localhost:6274/oauth/",
});

export function ServerForm({
  servers,
  onChange,
  readOnly,
  allowAdd = !readOnly,
  allowStructureEdits = !readOnly,
  showHeader = true
}: ServerFormProps) {
  const update = (index: number, patch: Partial<ServerConfig>) => {
    const next = servers.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  };

  const setAuthType = (index: number, nextType: ServerConfig["authType"]) => {
    const current = servers[index];
    if (!current) return;
    update(index, {
      authType: nextType,
      ...(nextType !== "oauth2"
        ? {
            oauthClientId: undefined,
            oauthClientSecret: undefined,
            oauthRedirectUrl: undefined,
            oauthScope: undefined
          }
        : {
            oauthRedirectUrl: current.oauthRedirectUrl || "http://localhost:6274/oauth/"
          })
    });
  };

  const remove = (index: number) => onChange(servers.filter((_, i) => i !== index));
  const add = () => onChange([...servers, emptyServer()]);

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Servers</h3>
          {!readOnly && allowAdd && (
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Add Server
            </Button>
          )}
        </div>
      )}
      {servers.map((srv, i) => (
        <Card key={srv.id} className="border-dashed">
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{srv.name || `Server ${i + 1}`}</CardTitle>
            {!readOnly && allowStructureEdits && (
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={srv.name} onChange={(e) => update(i, { name: e.target.value })} disabled={readOnly} placeholder="e.g. Filesystem MCP" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Transport</Label>
                <Select value={srv.transport} onValueChange={(v) => update(i, { transport: v as ServerConfig["transport"] })} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">stdio</SelectItem>
                    <SelectItem value="sse">SSE</SelectItem>
                    <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {srv.transport === "stdio" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Command</Label>
                  <Input value={srv.command || ""} onChange={(e) => update(i, { command: e.target.value })} disabled={readOnly} placeholder="npx" className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Args (comma-separated)</Label>
                  <Input value={(srv.args || []).join(", ")} onChange={(e) => update(i, { args: e.target.value.split(",").map((a) => a.trim()).filter(Boolean) })} disabled={readOnly} placeholder="-y, @mcp/server" className="font-mono text-xs" />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">URL</Label>
                <Input value={srv.url || ""} onChange={(e) => update(i, { url: e.target.value })} disabled={readOnly} placeholder="http://localhost:3001/sse" className="font-mono text-xs" />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Auth Type</Label>
                <Select value={srv.authType || "none"} onValueChange={(v) => setAuthType(i, v as ServerConfig["authType"])} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="bearer">Bearer Token</SelectItem>
                    <SelectItem value="api-key">API Key</SelectItem>
                    <SelectItem value="oauth2">OAuth 2.0</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {srv.authType && srv.authType !== "none" && srv.authType !== "oauth2" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">{srv.authType === "bearer" ? "Token" : "API Key"}</Label>
                  <Input type="password" value={srv.authValue || ""} onChange={(e) => update(i, { authValue: e.target.value })} disabled={readOnly} placeholder="••••••••" className="font-mono text-xs" />
                </div>
              )}
            </div>
            {srv.authType === "oauth2" && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="text-xs font-medium text-muted-foreground">OAuth 2.0 Flow</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Client ID</Label>
                    <Input
                      value={srv.oauthClientId || ""}
                      onChange={(e) => update(i, { oauthClientId: e.target.value })}
                      disabled={readOnly}
                      placeholder="your-client-id"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Client Secret (optional)</Label>
                    <Input
                      type="password"
                      value={srv.oauthClientSecret || ""}
                      onChange={(e) => update(i, { oauthClientSecret: e.target.value })}
                      disabled={readOnly}
                      placeholder="••••••••"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Redirect URL</Label>
                    <Input
                      value={srv.oauthRedirectUrl || "http://localhost:6274/oauth/"}
                      onChange={(e) => update(i, { oauthRedirectUrl: e.target.value })}
                      disabled={readOnly}
                      placeholder="http://localhost:6274/oauth/"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Scope (space-separated)</Label>
                    <Input
                      value={srv.oauthScope || ""}
                      onChange={(e) => update(i, { oauthScope: e.target.value })}
                      disabled={readOnly}
                      placeholder="openid profile mcp"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {servers.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No servers configured. Add one to get started.</p>
      )}
    </div>
  );
}
