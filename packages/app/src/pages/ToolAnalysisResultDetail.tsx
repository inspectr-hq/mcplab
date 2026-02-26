import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { SavedToolAnalysisReportRecord } from "@/lib/data-sources/types";
import { ToolAnalysisReportView, toolAnalysisReportToMarkdown } from "@/components/tool-analysis/ToolAnalysisReportView";
import { Download, Trash2 } from "lucide-react";

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ToolAnalysisResultDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { source } = useDataSource();
  const [record, setRecord] = useState<SavedToolAnalysisReportRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);
    source
      .getToolAnalysisSavedResult(id)
      .then((next) => {
        if (!active) return;
        setRecord(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const msg = (error instanceof Error ? error.message : String(error));
        if (msg.includes("(404)")) {
          setNotFound(true);
          setRecord(null);
          return;
        }
        toast({ title: "Could not load saved tool analysis report", description: msg, variant: "destructive" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, source]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await source.deleteToolAnalysisSavedResult(id);
      toast({ title: "Tool analysis report deleted" });
      navigate("/tool-analysis-results");
    } catch (error: unknown) {
      toast({ title: "Could not delete report", description: (error instanceof Error ? error.message : String(error)), variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading saved tool analysis report...</p>;
  }

  if (notFound || !record) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Tool Analysis Result</h1>
        <p className="text-sm text-muted-foreground">Saved report not found.</p>
        <Button asChild variant="outline">
          <Link to="/tool-analysis-results">Back to Tool Analysis Results</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-mono text-xl font-semibold">{record.reportId}</h1>
          <p className="text-sm text-muted-foreground">
            {new Date(record.createdAt).toLocaleString()} · {record.serverNames.join(", ") || "—"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/tool-analysis-results">Back to results</Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              downloadTextFile(`${record.reportId}.json`, `${JSON.stringify(record, null, 2)}\n`, "application/json")
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Export JSON
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              downloadTextFile(`${record.reportId}.md`, toolAnalysisReportToMarkdown(record.report), "text/markdown")
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Export Markdown
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <ToolAnalysisReportView report={record.report} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tool analysis report?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete saved report '{record.reportId}' from disk? This cannot be undone.
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

