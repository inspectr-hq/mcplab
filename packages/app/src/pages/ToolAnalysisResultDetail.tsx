import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useDataSource } from '@/contexts/useDataSource';
import { toast } from '@/hooks/use-toast';
import type { SavedToolAnalysisReportRecord } from '@/lib/data-sources/types';
import { ToolAnalysisReportView } from '@/components/tool-analysis/ToolAnalysisReportView';
import { toolAnalysisReportToMarkdown } from '@/lib/tool-analysis-markdown';
import { McpServerBadge } from '@/components/results/McpServerBadge';
import { formatProvider } from '@/lib/provider-format';
import { ArrowLeft, ChevronDown, Clock, Download, Trash2 } from 'lucide-react';
import { buildToolSchemaExport } from '@/lib/tool-analysis-export';

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ToolAnalysisResultDetailPage() {
  const { id = '' } = useParams();
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
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('(404)')) {
          setNotFound(true);
          setRecord(null);
          return;
        }
        toast({
          title: 'Could not load saved tool analysis report',
          description: msg,
          variant: 'destructive'
        });
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
      toast({ title: 'Tool analysis report deleted' });
      navigate('/tool-analysis-results');
    } catch (error: unknown) {
      toast({
        title: 'Could not delete report',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
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
        <h1 className="text-2xl font-bold">MCP Analysis Result</h1>
        <p className="text-sm text-muted-foreground">Saved report not found.</p>
        <Button asChild variant="outline">
          <Link to="/tool-analysis-results">Back to MCP Analysis Results</Link>
        </Button>
      </div>
    );
  }

  const assistant = [
    record.report.assistantAgentProvider
      ? formatProvider(record.report.assistantAgentProvider)
      : null,
    record.report.assistantAgentModel
  ]
    .filter(Boolean)
    .join(' · ');
  const hasToolSchemas = record.report.servers.some((server) => server.tools.length > 0);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Button asChild size="sm" variant="ghost" className="-ml-2 min-h-11 text-muted-foreground">
          <Link to="/tool-analysis-results">
            <ArrowLeft aria-hidden="true" />
            All analysis results
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">MCP analysis report</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <code className="wrap-anywhere">{record.reportId}</code>
              <time dateTime={record.createdAt} className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                {new Date(record.createdAt).toLocaleString()}
              </time>
              {assistant && <span>{assistant}</span>}
              <McpServerBadge versions={record.report.mcpServerVersions} />
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="min-h-11">
                Report actions
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="min-h-11 gap-2"
                onSelect={() =>
                  downloadTextFile(
                    `${record.reportId}.json`,
                    `${JSON.stringify(record, null, 2)}\n`,
                    'application/json'
                  )
                }
              >
                <Download className="size-4" aria-hidden="true" />
                Export JSON
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-11 gap-2"
                onSelect={() =>
                  downloadTextFile(
                    `${record.reportId}.md`,
                    toolAnalysisReportToMarkdown(record.report),
                    'text/markdown'
                  )
                }
              >
                <Download className="size-4" aria-hidden="true" />
                Export Markdown
              </DropdownMenuItem>
              {hasToolSchemas && (
                <DropdownMenuItem
                  className="min-h-11 gap-2"
                  onSelect={() =>
                    downloadTextFile(
                      `${record.reportId}-tool-schemas.json`,
                      `${JSON.stringify(buildToolSchemaExport(record), null, 2)}\n`,
                      'application/json'
                    )
                  }
                >
                  <Download className="size-4" aria-hidden="true" />
                  Export MCP info
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-11 gap-2 text-destructive focus:text-destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

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
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
