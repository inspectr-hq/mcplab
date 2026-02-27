import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { MarkdownReportContent } from "@/lib/data-sources/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectRunId(report: MarkdownReportContent): string | null {
  const pathMatch = report.relativePath.match(/(?:^|\/)(?:result-assistant|results?)\/([0-9]{8}-[0-9]{6})(?:-|\/)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const contentMatch =
    report.content.match(/(?:^|\n)\s*\*\*Run:\*\*\s*`([^`]+)`/i) ??
    report.content.match(/(?:^|\n)\s*Run ID:\s*([^\s]+)/i);
  return contentMatch?.[1]?.trim() || null;
}

export default function MarkdownReportDetailPage() {
  const { source } = useDataSource();
  const [searchParams] = useSearchParams();
  const relativePath = (searchParams.get("path") ?? "").trim();
  const [report, setReport] = useState<MarkdownReportContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [resultPanelOpen, setResultPanelOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setReport(null);
    setNotFound(false);
    if (!relativePath) {
      setLoading(false);
      return;
    }
    setLoading(true);
    source
      .getMarkdownReport(relativePath)
      .then((next) => {
        if (!active) return;
        setReport(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const msg = (error instanceof Error ? error.message : String(error));
        if (msg.includes("(404)")) {
          setNotFound(true);
          return;
        }
        toast({
          title: "Could not load markdown report",
          description: msg,
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [relativePath, source]);

  if (!relativePath) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Markdown Report</h1>
        <p className="text-sm text-muted-foreground">Missing report path.</p>
        <Button asChild variant="outline">
          <Link to="/markdown-reports">Back to Markdown Reports</Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading markdown report...</p>;
  }

  if (notFound || !report) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Markdown Report</h1>
        <p className="text-sm text-muted-foreground">Report not found.</p>
        <Button asChild variant="outline">
          <Link to="/markdown-reports">Back to Markdown Reports</Link>
        </Button>
      </div>
    );
  }

  const linkedRunId = detectRunId(report);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-mono text-xl font-semibold">{report.name}</h1>
          <p className="truncate text-sm text-muted-foreground">{report.relativePath}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(report.mtime).toLocaleString()} {" · "} {formatBytes(report.sizeBytes)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {linkedRunId ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setResultPanelOpen(true)}>
                Open Result Panel
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to={`/results/${encodeURIComponent(linkedRunId)}`}>Open Result</Link>
              </Button>
            </>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link to="/markdown-reports">Back to reports</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <MarkdownContent text={report.content} variant="assistant" />
        </CardContent>
      </Card>

      {linkedRunId ? (
        <Sheet open={resultPanelOpen} onOpenChange={setResultPanelOpen}>
          <SheetContent side="right" className="w-[96vw] max-w-none p-0 sm:max-w-5xl">
            <SheetHeader className="border-b px-4 py-3 pr-12">
              <div className="flex items-center justify-between gap-2">
                <SheetTitle className="text-base">Result {linkedRunId}</SheetTitle>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/results/${encodeURIComponent(linkedRunId)}`} target="_blank" rel="noreferrer">
                    Open full page
                  </Link>
                </Button>
              </div>
            </SheetHeader>
            <div className="h-[calc(100vh-64px)]">
              <iframe
                title={`Result ${linkedRunId}`}
                src={`/results/${encodeURIComponent(linkedRunId)}?embed=1`}
                className="h-full w-full border-0"
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
