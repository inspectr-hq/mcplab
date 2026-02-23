import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { ToolAnalysisResultSummary } from "@/lib/data-sources/types";
import { Download, Trash2 } from "lucide-react";
import { toolAnalysisReportToMarkdown } from "@/components/tool-analysis/ToolAnalysisReportView";

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ToolAnalysisResultsPage() {
  const { source } = useDataSource();
  const [items, setItems] = useState<ToolAnalysisResultSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await source.listToolAnalysisResults());
    } catch (error: any) {
      toast({ title: "Could not load tool analysis results", description: String(error?.message ?? error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteTarget = useMemo(() => items.find((i) => i.reportId === deleteId) ?? null, [items, deleteId]);

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await source.deleteToolAnalysisSavedResult(deleteId);
      setItems((prev) => prev.filter((i) => i.reportId !== deleteId));
      toast({ title: "Tool analysis report deleted" });
      setDeleteId(null);
    } catch (error: any) {
      toast({ title: "Could not delete report", description: String(error?.message ?? error), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const exportReport = async (id: string, format: "json" | "markdown") => {
    try {
      const record = await source.getToolAnalysisSavedResult(id);
      if (format === "json") {
        downloadTextFile(`${id}.json`, `${JSON.stringify(record, null, 2)}\n`, "application/json");
      } else {
        downloadTextFile(`${id}.md`, toolAnalysisReportToMarkdown(record.report), "text/markdown");
      }
    } catch (error: any) {
      toast({ title: "Could not export saved report", description: String(error?.message ?? error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tool Analysis Results</h1>
          <p className="text-sm text-muted-foreground">Browse persisted Analyze MCP Tools reports.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/tool-analysis">Analyze MCP Tools</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved reports</CardTitle>
          <CardDescription>
            {loading ? "Loading..." : `${items.length} saved report${items.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading tool analysis results...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved tool analysis reports yet.</p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.reportId} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/tool-analysis-results/${item.reportId}`} className="font-mono text-sm font-medium hover:underline">
                          {item.reportId}
                        </Link>
                        <Badge variant="outline">{new Date(item.createdAt).toLocaleString()}</Badge>
                        {item.modes.metadataReview && <Badge variant="outline">metadata</Badge>}
                        {item.modes.deeperAnalysis && <Badge variant="outline">deeper</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Server: <span className="font-medium text-foreground">{item.serverNames.join(", ") || "—"}</span>
                        {" · "}Tools analyzed: {item.summary.toolsAnalyzed}
                        {" · "}Skipped: {item.summary.toolsSkipped}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(["critical", "high", "medium", "low", "info"] as const).map((sev) =>
                          item.summary.issueCounts[sev] > 0 ? (
                            <Badge key={`${item.reportId}-${sev}`} variant="outline" className="capitalize">
                              {sev}: {item.summary.issueCounts[sev]}
                            </Badge>
                          ) : null
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/tool-analysis-results/${item.reportId}`}>View</Link>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void exportReport(item.reportId, "json")}>
                        <Download className="mr-2 h-4 w-4" /> JSON
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void exportReport(item.reportId, "markdown")}>
                        <Download className="mr-2 h-4 w-4" /> MD
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDeleteId(item.reportId)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tool analysis report?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Delete saved report '${deleteTarget.reportId}' from disk? This cannot be undone.`
                : "Delete this saved report from disk? This cannot be undone."}
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

