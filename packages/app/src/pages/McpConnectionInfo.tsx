import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { WorkspaceHealthResponse } from "@/lib/data-sources/types";

const DEFAULT_MCP_HOST = "127.0.0.1";
const DEFAULT_MCP_PORT = 3011;
const DEFAULT_MCP_PATH = "/mcp";
const DEFAULT_DIRECT_URL = `http://${DEFAULT_MCP_HOST}:${DEFAULT_MCP_PORT}${DEFAULT_MCP_PATH}`;

function copyToClipboard(text: string) {
  return navigator.clipboard.writeText(text);
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await copyToClipboard(text);
      setCopied(true);
      toast({
        title: "Copied",
        description: `${label} copied to clipboard.`
      });
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error: unknown) {
      toast({
        title: "Copy failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    }
  };

  return (
    <Button type="button" size="sm" variant="outline" onClick={() => void handleCopy()}>
      <Copy className="mr-2 h-3.5 w-3.5" />
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function InfoRow({
  label,
  value,
  copyText,
  valueClassName = ""
}: {
  label: string;
  value: string;
  copyText?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </div>
          <div className={`mt-1 break-all text-sm font-medium ${valueClassName}`}>{value}</div>
        </div>
        {copyText && <CopyButton text={copyText} label={label} />}
      </div>
    </div>
  );
}

function SnippetCard({
  title,
  description,
  code,
  iconSrc
}: {
  title: string;
  description: string;
  code: string;
  iconSrc: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <img src={iconSrc} alt="" aria-hidden="true" className="h-4 w-4" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-all">
          {code}
        </pre>
        <div className="flex justify-end">
          <CopyButton text={code} label={title} />
        </div>
      </CardContent>
    </Card>
  );
}

const McpConnectionInfoPage = () => {
  const { source } = useDataSource();
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<WorkspaceHealthResponse | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    try {
      const nextHealth = await source.health();
      setHealth(nextHealth);
    } catch (error: unknown) {
      setHealth(null);
      toast({
        title: "Could not load MCP connection info",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const mcp = health?.mcp?.enabled ? health.mcp : null;
  const directUrl = mcp?.directUrl ?? DEFAULT_DIRECT_URL;
  const transport = mcp?.transport ?? "streamable-http";

  const claudeSnippet = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            mcplab: {
              command: "npx",
              args: ["mcp-remote", directUrl]
            }
          }
        },
        null,
        2
      ),
    [directUrl]
  );

  const genericSnippet = useMemo(
    () =>
      JSON.stringify(
        {
          name: "mcplab",
          transport,
          url: directUrl
        },
        null,
        2
      ),
    [directUrl, transport]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <Link2 className="h-6 w-6" />
            MCP Connection Info
          </h1>
          <p className="text-sm text-muted-foreground">
            Copy the local MCPLab MCP server details into Claude Desktop or any MCP-capable client.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void loadHealth()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {!mcp && (
        <Alert>
          <Link2 className="h-4 w-4" />
          <AlertTitle>MCP server not reported</AlertTitle>
          <AlertDescription>
            The page is showing the default local connection details. Start MCP Lab in dev mode to
            see the live runtime endpoint and package version.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Connection Details</CardTitle>
            <CardDescription>
              The local server is exposed over streamable HTTP.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3">
              <InfoRow label="Direct MCP URL" value={directUrl} copyText={directUrl} />
              <InfoRow label="Transport" value={transport} />
              <InfoRow label="Authentication" value="none" />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <SnippetCard
            title="Claude Desktop"
            description="Use mcp-remote to bridge Claude Desktop to the local streamable HTTP MCP server."
            code={claudeSnippet}
            iconSrc="/icons/claude-color.svg"
          />
          <SnippetCard
            title="OpenAI / MCP-capable client"
            description="Use this endpoint block in any client or adapter that accepts a single MCP-over-HTTP server."
            code={genericSnippet}
            iconSrc="/icons/openai.svg"
          />
        </div>
      </div>
    </div>
  );
};

export default McpConnectionInfoPage;
