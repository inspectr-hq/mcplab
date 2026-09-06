import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useDataSource } from '@/contexts/DataSourceContext';
import { toast } from '@/hooks/use-toast';
import type { ToolAnalysisResultSummary } from '@/lib/data-sources/types';
import { Clock, Download, MoreHorizontal, Trash2, NotebookTabs, ChevronDown } from 'lucide-react';
import { toolAnalysisReportToMarkdown } from '@/components/tool-analysis/ToolAnalysisReportView';
import { buildToolSchemaExport } from '@/lib/tool-analysis-export';
import { useOffsetPagination } from '@/hooks/use-offset-pagination';

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
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
  const [serverFilter, setServerFilter] = useState('all');
  const [openServerFilterPicker, setOpenServerFilterPicker] = useState(false);
  const [serverOptions, setServerOptions] = useState<string[]>([]);
  const limit = 100;
  const pagination = useOffsetPagination(limit);
  const { offset, hasMore } = pagination;

  const load = async () => {
    setLoading(true);
    try {
      if (source.listToolAnalysisResultsPage) {
        const page = await source.listToolAnalysisResultsPage({
          limit,
          offset,
          server: serverFilter === 'all' ? undefined : serverFilter
        });
        setItems(page.data);
        pagination.updateMeta(page);
      } else {
        setItems(
          await source.listToolAnalysisResults({
            limit,
            offset,
            server: serverFilter === 'all' ? undefined : serverFilter
          })
        );
      }
    } catch (error: unknown) {
      toast({
        title: 'Could not load tool analysis results',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, serverFilter]);

  useEffect(() => {
    if (!source.listToolAnalysisServers) return;
    void source
      .listToolAnalysisServers()
      .then((servers) => setServerOptions(servers))
      .catch(() => {
        setServerOptions([]);
      });
  }, [source]);

  useEffect(() => {
    if (source.listToolAnalysisServers) return;
    setServerOptions(
      Array.from(new Set(items.flatMap((item) => item.serverNames))).sort((a, b) =>
        a.localeCompare(b)
      )
    );
  }, [items, source]);

  useEffect(() => {
    pagination.reset();
  }, [pagination.reset, serverFilter]);

  const deleteTarget = useMemo(
    () => items.find((i) => i.reportId === deleteId) ?? null,
    [items, deleteId]
  );

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await source.deleteToolAnalysisSavedResult(deleteId);
      setItems((prev) => prev.filter((i) => i.reportId !== deleteId));
      toast({ title: 'Tool analysis report deleted' });
      setDeleteId(null);
    } catch (error: unknown) {
      toast({
        title: 'Could not delete report',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setDeleting(false);
    }
  };

  const exportReport = async (id: string, format: 'json' | 'markdown' | 'tool_schemas') => {
    try {
      const record = await source.getToolAnalysisSavedResult(id);
      if (format === 'json') {
        downloadTextFile(`${id}.json`, `${JSON.stringify(record, null, 2)}\n`, 'application/json');
      } else if (format === 'tool_schemas') {
        downloadTextFile(
          `${id}-tool-schemas.json`,
          `${JSON.stringify(buildToolSchemaExport(record), null, 2)}\n`,
          'application/json'
        );
      } else {
        downloadTextFile(`${id}.md`, toolAnalysisReportToMarkdown(record.report), 'text/markdown');
      }
    } catch (error: unknown) {
      toast({
        title: 'Could not export saved report',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <NotebookTabs className="h-6 w-6" />
            Tool Analysis Results
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse persisted Analyze MCP Tools reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">MCP server</span>
            <Popover open={openServerFilterPicker} onOpenChange={setOpenServerFilterPicker}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={openServerFilterPicker}
                  aria-controls="tool-analysis-server-command-list"
                  className={`h-9 w-[240px] justify-between font-normal ${
                    serverFilter !== 'all' ? 'border-primary/40' : ''
                  }`}
                >
                  <span className="truncate text-left">
                    {serverFilter === 'all' ? 'All servers' : serverFilter}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[240px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search MCP servers..." />
                  <CommandList id="tool-analysis-server-command-list">
                    <CommandEmpty>No servers found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="all servers"
                        onSelect={() => {
                          setServerFilter('all');
                          setOpenServerFilterPicker(false);
                        }}
                      >
                        All servers
                      </CommandItem>
                      {serverOptions.map((serverName) => (
                        <CommandItem
                          key={serverName}
                          value={serverName}
                          onSelect={() => {
                            setServerFilter(serverName);
                            setOpenServerFilterPicker(false);
                          }}
                        >
                          {serverName}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button variant="outline" onClick={pagination.prev} disabled={loading || offset === 0}>
            Prev
          </Button>
          <Button variant="outline" onClick={pagination.next} disabled={loading || !hasMore}>
            Next
          </Button>
          <Button asChild variant="outline">
            <Link to="/tool-analysis">Analyze MCP Tools</Link>
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{pagination.rangeLabel(items.length)}</p>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading tool analysis results...</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No saved tool analysis reports yet.</p>
          ) : (
            <>
              <div className="border-b px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Showing <span className="font-medium text-foreground">{items.length}</span>{' '}
                  reports
                </p>
              </div>
              {items.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No reports for the selected MCP server.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Report ID</TableHead>
                      <TableHead>Evaluated</TableHead>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Issues</TableHead>
                      <TableHead>Modes</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.reportId}>
                        <TableCell>
                          <div className="space-y-1">
                            <Link
                              to={`/tool-analysis-results/${item.reportId}`}
                              className="font-mono text-xs text-primary hover:underline"
                            >
                              {item.reportId}
                            </Link>
                            <div className="text-[11px] text-muted-foreground">
                              {item.assistantAgentName} · {item.assistantAgentModel}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground">
                          <div className="space-y-0.5">
                            <div>
                              Servers:{' '}
                              <span className="font-medium text-foreground">
                                {item.serverNames.length}
                              </span>{' '}
                              · Tools:{' '}
                              <span className="font-medium text-foreground">
                                {item.summary.toolsAnalyzed}
                              </span>
                              {' · '}Skipped:{' '}
                              <span className="font-medium text-foreground">
                                {item.summary.toolsSkipped}
                              </span>
                            </div>
                            <div className="font-mono text-xs text-foreground/80">
                              {item.serverNames.slice(0, 2).join(', ')}
                              {item.serverNames.length > 2
                                ? ` +${item.serverNames.length - 2}`
                                : ''}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(item.createdAt).toLocaleString()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) =>
                              item.summary.issueCounts[sev] > 0 ? (
                                <Badge
                                  key={`${item.reportId}-${sev}`}
                                  variant="outline"
                                  className="capitalize"
                                >
                                  {sev}: {item.summary.issueCounts[sev]}
                                </Badge>
                              ) : null
                            )}
                            {Object.values(item.summary.issueCounts).every((n) => n === 0) && (
                              <Badge variant="outline">No issues</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {item.modes.metadataReview && <Badge variant="outline">metadata</Badge>}
                            {item.modes.deeperAnalysis && <Badge variant="outline">deeper</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link to={`/tool-analysis-results/${item.reportId}`}>View</Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void exportReport(item.reportId, 'json')}
                              >
                                <Download className="mr-2 h-3.5 w-3.5" /> Export JSON
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void exportReport(item.reportId, 'markdown')}
                              >
                                <Download className="mr-2 h-3.5 w-3.5" /> Export Markdown
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onSelect={(e) => {
                                  e.preventDefault();
                                  setDeleteId(item.reportId);
                                }}
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void exportReport(item.reportId, 'tool_schemas')}
                              >
                                <Download className="mr-2 h-3.5 w-3.5" /> Export MCP Info
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
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
                : 'Delete this saved report from disk? This cannot be undone.'}
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
