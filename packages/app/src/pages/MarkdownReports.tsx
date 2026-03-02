import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { MarkdownReportSummary } from "@/lib/data-sources/types";
import {Clock, MoreHorizontal, NotepadText, Trash2} from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MarkdownReportsPage() {
  const { source } = useDataSource();
  const [items, setItems] = useState<MarkdownReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletePath, setDeletePath] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await source.listMarkdownReports());
    } catch (error: unknown) {
      toast({
        title: "Could not load markdown reports",
        description: (error instanceof Error ? error.message : String(error)),
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
  const deleteTarget = useMemo(() => items.find((item) => item.relativePath === deletePath) ?? null, [items, deletePath]);

  const handleDelete = async () => {
    if (!deletePath) return;
    setDeleting(true);
    try {
      await source.deleteMarkdownReport(deletePath);
      setItems((prev) => prev.filter((item) => item.relativePath !== deletePath));
      toast({ title: "Markdown report deleted" });
      setDeletePath(null);
    } catch (error: unknown) {
      toast({
        title: "Could not delete markdown report",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <NotepadText className="h-6 w-6" />
            Markdown Reports
          </h1>
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
                          <DropdownMenuItem
                            className="text-destructive"
                            onSelect={(e) => {
                              e.preventDefault();
                              setDeletePath(item.relativePath);
                            }}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
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

      <AlertDialog open={Boolean(deletePath)} onOpenChange={(open) => !open && setDeletePath(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete markdown report?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Delete '${deleteTarget.name}' from disk? This cannot be undone.`
                : "Delete this report from disk? This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void handleDelete(); }} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
