import { Link } from "react-router-dom";
import { Clock, MoreHorizontal, Eye, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PassRateBadge } from "@/components/PassRateBadge";
import { mockResults } from "@/data/mock-data";

const Results = () => {
  const sorted = [...mockResults].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Results</h1>
        <p className="text-sm text-muted-foreground">Browse and compare evaluation results</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run ID</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Pass Rate</TableHead>
                <TableHead>Scenarios</TableHead>
                <TableHead>Avg Tool Calls</TableHead>
                <TableHead>Config Hash</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link to={`/results/${r.id}`} className="font-mono text-xs text-primary hover:underline">{r.id}</Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(r.timestamp).toLocaleString()}</div>
                  </TableCell>
                  <TableCell><PassRateBadge rate={r.overallPassRate} /></TableCell>
                  <TableCell className="font-mono text-sm">{r.totalScenarios}</TableCell>
                  <TableCell className="font-mono text-sm">{r.avgToolCalls.toFixed(1)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.configHash.slice(0, 8)}…</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild><Link to={`/results/${r.id}`}><Eye className="mr-2 h-3.5 w-3.5" />View</Link></DropdownMenuItem>
                        <DropdownMenuItem><Download className="mr-2 h-3.5 w-3.5" />Export JSON</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-3.5 w-3.5" />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Results;
