import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { MarkdownReportSummary } from "@/lib/data-sources/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MarkdownReportsPage() {
  const { source } = useDataSource();
  const [items, setItems] = useState<MarkdownReportSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await source.listMarkdownReports());
    } catch (error: any) {
      toast({
        title: "Could not load markdown reports",
        description: String(error?.message ?? error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latest = useMemo(() => items[0], [items]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Markdown Reports</h1>
          <p className="text-sm text-muted-foreground">
            Browse Markdown files under <code>mcplab/reports</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {latest ? (
            <Button asChild variant="outline">
              <Link to={`/markdown-reports/view?path=${encodeURIComponent(latest.relativePath)}`}>
                Open latest
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved Markdown reports</CardTitle>
          <CardDescription>
            {loading ? "Loading..." : `${items.length} report${items.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading markdown reports...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No markdown reports found yet.</p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.path} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <Link
                        to={`/markdown-reports/view?path=${encodeURIComponent(item.relativePath)}`}
                        className="font-mono text-sm font-medium hover:underline"
                      >
                        {item.relativePath}
                      </Link>
                      <div className="text-sm text-muted-foreground">
                        {new Date(item.mtime).toLocaleString()} {" · "} {formatBytes(item.sizeBytes)}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        to={`/markdown-reports/view?path=${encodeURIComponent(item.relativePath)}`}
                      >
                        View
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
