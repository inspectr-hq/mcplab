import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Wifi, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLibraries } from "@/contexts/LibraryContext";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import { validateServerAuthConfig } from "@/lib/server-auth-validation";
import type { ServerConfig } from "@/types/eval";

type ConnectState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; toolNames: string[]; toolCount: number; testedAt: string }
  | { status: "error"; message: string; testedAt: string };

const transportHints: Record<string, string> = {
  stdio: "Check that the command is installed and the args are correct",
  sse: "Check that the server is running and the URL is reachable",
  "streamable-http": "Check that the server is running and the URL is reachable",
};

const emptyServer = (): ServerConfig => ({
  id: `srv-${Date.now()}`,
  name: "",
  transport: "stdio",
  authType: "none",
  oauthRedirectUrl: "http://localhost:6274/oauth/",
});

const ServerDetail = () => {
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();
  const { servers, setServers } = useLibraries();
  const { source } = useDataSource();

  const isNew = serverId === "new";
  const decodedParam = serverId ? decodeURIComponent(serverId) : "";
  const existingServer = isNew ? null : servers.find((s) => s.id === decodedParam || s.name === decodedParam);
  const displayName = (server: ServerConfig) => server.name?.trim() || server.id;

  const [form, setForm] = useState<ServerConfig>(() => existingServer ?? emptyServer());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connectState, setConnectState] = useState<ConnectState>({ status: "idle" });
  const [showConnectPanel, setShowConnectPanel] = useState(false);

  useEffect(() => {
    if (existingServer) setForm(existingServer);
  }, [existingServer]);

  const setAuthType = (nextType: ServerConfig["authType"]) => {
    setForm((f) => ({
      ...f,
      authType: nextType,
      // Clear fields not relevant to the new type
      ...(nextType !== "bearer" && nextType !== "api-key"
        ? { authValue: undefined }
        : {}),
      ...(nextType !== "api-key"
        ? { apiKeyHeaderName: undefined }
        : { apiKeyHeaderName: f.apiKeyHeaderName || "X-API-Key" }),
      ...(nextType !== "oauth2"
        ? {
            oauthClientId: undefined,
            oauthClientSecret: undefined,
            oauthRedirectUrl: undefined,
            oauthScope: undefined,
          }
        : {
            oauthRedirectUrl: f.oauthRedirectUrl || "http://localhost:6274/oauth/",
          }),
    }));
  };

  const handleConnect = async () => {
    setShowConnectPanel(true);
    setConnectState({ status: "loading" });
    try {
      const result = await source.discoverToolsForAnalysis({ serverNames: [form.id] });
      const serverResult = result.servers[0];
      if (serverResult && serverResult.warnings.length === 0) {
        setConnectState({
          status: "success",
          toolNames: serverResult.tools.map((t) => t.name),
          toolCount: serverResult.tools.length,
          testedAt: new Date().toISOString(),
        });
      } else {
        setConnectState({
          status: "error",
          message: serverResult?.warnings[0] ?? "Connection failed",
          testedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      setConnectState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        testedAt: new Date().toISOString(),
      });
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const authValidationError = validateServerAuthConfig(form);
    if (authValidationError) {
      toast({ title: "Validation Error", description: authValidationError, variant: "destructive" });
      return;
    }
    const normalizedForm: ServerConfig = {
      ...form,
      authValue: form.authValue?.trim(),
      apiKeyHeaderName: form.apiKeyHeaderName?.trim() || undefined
    };
    setSaving(true);
    try {
      if (isNew) {
        await setServers([...servers, normalizedForm]);
        toast({ title: "Server created" });
        navigate(`/libraries/servers/${encodeURIComponent(normalizedForm.id)}`);
      } else {
        const next = servers.map((s) => (s.id === existingServer?.id ? normalizedForm : s));
        await setServers(next);
        toast({ title: "Server saved" });
        if (normalizedForm.id !== decodedParam) {
          navigate(`/libraries/servers/${encodeURIComponent(normalizedForm.id)}`, { replace: true });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const next = servers.filter((s) => s.id !== existingServer?.id);
    await setServers(next);
    toast({ title: "Server deleted" });
    navigate("/libraries/servers");
  };

  const getEndpointDisplay = () => {
    if (form.transport === "stdio") {
      return [form.command, ...(form.args || [])].filter(Boolean).join(" ");
    }
    return form.url || "";
  };

  if (!isNew && !existingServer) {
    return (
      <div className="space-y-4">
        <Link
          to="/libraries/servers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Servers
        </Link>
        <p className="text-sm text-muted-foreground">Server "{decodedParam}" not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <Link
            to="/libraries/servers"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Servers
          </Link>
          <h1 className="text-2xl font-bold">{isNew ? "New Server" : displayName(form)}</h1>
        </div>
        {!isNew && (
          <Button type="button" onClick={() => void handleConnect()}>
            <Wifi className="mr-2 h-4 w-4" />
            Test Connection
          </Button>
        )}
      </div>

      {/* Connect Panel */}
      {showConnectPanel && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Connection Test</CardTitle>
            <button
              type="button"
              onClick={() => setShowConnectPanel(false)}
              className="rounded-sm opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>Server:</span>
              <span className="font-medium text-foreground">{displayName(form)}</span>
              <span className="mx-1">·</span>
              <span>Transport:</span>
              <span className="font-medium text-foreground">{form.transport}</span>
              {getEndpointDisplay() && (
                <>
                  <span className="mx-1">·</span>
                  <span>Endpoint:</span>
                  <code className="font-mono text-xs">{getEndpointDisplay()}</code>
                </>
              )}
            </div>

            {connectState.status === "loading" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting to MCP server…
              </div>
            )}

            {connectState.status === "success" && (
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm text-emerald-700">
                  <Check className="h-4 w-4 shrink-0" />
                  Connected — discovered {connectState.toolCount} tool{connectState.toolCount !== 1 ? "s" : ""}
                </p>
                {connectState.toolNames.length > 0 && (
                  <div className="rounded-md bg-muted p-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">First 5 tools:</p>
                    <ul className="space-y-0.5">
                      {connectState.toolNames.slice(0, 5).map((name) => (
                        <li key={name} className="font-mono text-xs">{name}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Tested at {new Date(connectState.testedAt).toLocaleString()}
                </p>
              </div>
            )}

            {connectState.status === "error" && (
              <div className="space-y-2">
                <p className="text-sm text-destructive">
                  <span className="font-medium">✗ Connection failed</span> — {connectState.message}
                </p>
                {transportHints[form.transport] && (
                  <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    Hint: {transportHints[form.transport]}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Tested at {new Date(connectState.testedAt).toLocaleString()}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Filesystem MCP"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Transport</Label>
              <Select
                value={form.transport}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, transport: v as ServerConfig["transport"] }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                  <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.transport === "stdio" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Command</Label>
                <Input
                  value={form.command || ""}
                  onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                  placeholder="npx"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Args (comma-separated)</Label>
                <Input
                  value={(form.args || []).join(", ")}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      args: e.target.value.split(",").map((a) => a.trim()).filter(Boolean),
                    }))
                  }
                  placeholder="-y, @mcp/server"
                  className="font-mono text-xs"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>URL</Label>
              <Input
                value={form.url || ""}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="http://localhost:3001/sse"
                className="font-mono text-xs"
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Auth Type</Label>
              <Select
                value={form.authType || "none"}
                onValueChange={(v) => setAuthType(v as ServerConfig["authType"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="bearer">Bearer Token</SelectItem>
                  <SelectItem value="api-key">API Key</SelectItem>
                  <SelectItem value="oauth2">OAuth 2.0</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.authType === "bearer" && (
              <div className="space-y-1.5">
                <Label>Token</Label>
                <Input
                  value={form.authValue || ""}
                  onChange={(e) => setForm((f) => ({ ...f, authValue: e.target.value }))}
                  placeholder="${DATABRICKS_TOKEN}"
                  className="font-mono text-xs"
                />
              </div>
            )}
          </div>

          {form.authType === "bearer" && (
            <p className="text-xs text-muted-foreground -mt-1">
              Use <code className="rounded bg-muted px-1">{`\${VAR_NAME}`}</code> to reference an environment variable, or enter a token directly.
            </p>
          )}

          {form.authType === "api-key" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="text-xs font-medium text-muted-foreground">API Key</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Header Name</Label>
                  <Input
                    value={form.apiKeyHeaderName || "X-API-Key"}
                    onChange={(e) => setForm((f) => ({ ...f, apiKeyHeaderName: e.target.value }))}
                    placeholder="X-API-Key"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Value</Label>
                  <Input
                    value={form.authValue || ""}
                    onChange={(e) => setForm((f) => ({ ...f, authValue: e.target.value }))}
                    placeholder="${MY_API_KEY}"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Use <code className="rounded bg-muted px-1">{`\${VAR_NAME}`}</code> to reference an environment variable, or enter a value directly.
              </p>
            </div>
          )}

          {form.authType === "oauth2" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="text-xs font-medium text-muted-foreground">OAuth 2.0 Flow</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Client ID</Label>
                  <Input
                    value={form.oauthClientId || ""}
                    onChange={(e) => setForm((f) => ({ ...f, oauthClientId: e.target.value }))}
                    placeholder="your-client-id"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Client Secret (optional)</Label>
                  <Input
                    type="password"
                    value={form.oauthClientSecret || ""}
                    onChange={(e) => setForm((f) => ({ ...f, oauthClientSecret: e.target.value }))}
                    placeholder="••••••••"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Redirect URL</Label>
                  <Input
                    value={form.oauthRedirectUrl || "http://localhost:6274/oauth/"}
                    onChange={(e) => setForm((f) => ({ ...f, oauthRedirectUrl: e.target.value }))}
                    placeholder="http://localhost:6274/oauth/"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Scope (space-separated)</Label>
                  <Input
                    value={form.oauthScope || ""}
                    onChange={(e) => setForm((f) => ({ ...f, oauthScope: e.target.value }))}
                    placeholder="openid profile mcp"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div>
              {!isNew && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  Delete
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate("/libraries/servers")}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isNew ? "Create Server" : "Save"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete server?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the server{" "}
              <span className="font-mono">{form.name}</span>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ServerDetail;
