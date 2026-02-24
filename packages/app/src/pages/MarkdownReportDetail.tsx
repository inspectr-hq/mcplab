import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { MarkdownReportContent } from "@/lib/data-sources/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MarkdownReportDetailPage() {
  const { source } = useDataSource();
  const [searchParams] = useSearchParams();
  const relativePath = (searchParams.get("path") ?? "").trim();
  const [report, setReport] = useState<MarkdownReportContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
      .catch((error: any) => {
        if (!active) return;
        const msg = String(error?.message ?? error);
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
        <Button asChild variant="outline" size="sm">
          <Link to="/markdown-reports">Back to reports</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <MarkdownContent text={report.content} variant="assistant" />
        </CardContent>
      </Card>
    </div>
  );
}
