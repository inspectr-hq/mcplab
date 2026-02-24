import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { MarkdownReportSummary } from "@/lib/data-sources/types";
import {Clock, MoreHorizontal} from "lucide-react";

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
          <Button variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
          {latest ? (
            <Button asChild variant="outline">
              <Link to={`/markdown-reports/view?path=${encodeURIComponent(latest.relativePath)}`}>
                Open latest
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading markdown reports...</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No markdown reports found yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead>Folder</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.path}>
                    <TableCell>
                      <div className="space-y-1">
                        <Link
                          to={`/markdown-reports/view?path=${encodeURIComponent(item.relativePath)}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {item.name}
                        </Link>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {item.relativePath}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {item.relativePath.includes("/")
                        ? item.relativePath.slice(0, item.relativePath.lastIndexOf("/"))
                        : "."}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(item.mtime).toLocaleString()}</div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{formatBytes(item.sizeBytes)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/markdown-reports/view?path=${encodeURIComponent(item.relativePath)}`}>
                              View
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
