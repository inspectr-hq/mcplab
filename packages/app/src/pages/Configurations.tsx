import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Upload, MoreHorizontal, Copy, Trash2, Download, Pencil, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfigs } from "@/contexts/ConfigContext";
import { toast } from "@/hooks/use-toast";

const Configurations = () => {
  const { configs, deleteConfig, cloneConfig, loading, reload } = useConfigs();
  const navigate = useNavigate();
  const [sortBy, setSortBy] = useState<"name" | "scenarios" | "agents" | "updatedAt">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (next: typeof sortBy) => {
    if (sortBy === next) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(next);
    setSortDir(next === "updatedAt" ? "desc" : "asc");
  };

  useEffect(() => {
    void reload();
    const handleFocus = () => {
      void reload();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [reload]);

  const handleDelete = async (id: string, name: string) => {
    await deleteConfig(id);
    toast({ title: "Deleted", description: `"${name}" has been removed.` });
  };

  const handleClone = async (id: string) => {
    const cloned = await cloneConfig(id);
    toast({ title: "Cloned", description: `Created "${cloned.name}".` });
    navigate(`/configs/${cloned.id}`);
  };

  const sortedConfigs = useMemo(() => {
    const sorted = [...configs].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") cmp = a.name.localeCompare(b.name);
      if (sortBy === "scenarios") cmp = a.scenarios.length - b.scenarios.length;
      if (sortBy === "agents") cmp = a.agents.length - b.agents.length;
      if (sortBy === "updatedAt") cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [configs, sortBy, sortDir]);

  const sortIcon = (key: typeof sortBy) => {
    if (sortBy !== key) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">MCP Evaluations</h1>
          <p className="text-sm text-muted-foreground">Manage your MCP evaluation suites</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            <RefreshCw className="mr-2 h-4 w-4" />Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" />Import YAML
          </Button>
          <Button size="sm" asChild>
            <Link to="/configs/new"><Plus className="mr-2 h-4 w-4" />Create New</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("name")}>
                    Name
                    {sortIcon("name")}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("scenarios")}>
                    Scenarios
                    {sortIcon("scenarios")}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("agents")}>
                    Agents
                    {sortIcon("agents")}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("updatedAt")}>
                    Last Updated
                    {sortIcon("updatedAt")}
                  </button>
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedConfigs.map((cfg) => (
                <TableRow key={cfg.id}>
                  <TableCell>
                    <div>
                      <Link to={`/configs/${cfg.id}`} className="font-medium text-sm hover:text-primary">{cfg.name}</Link>
                      {cfg.loadError && (
                        <Badge variant="destructive" className="ml-2 align-middle text-[10px]">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Broken
                        </Badge>
                      )}
                      {cfg.description && <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>}
                      {cfg.loadError && (
                        <p className="text-xs text-destructive mt-0.5 break-all">
                          {cfg.loadError}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{cfg.scenarios.length}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{cfg.agents.length}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {new Date(cfg.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/configs/${cfg.id}`)}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleClone(cfg.id)}>
                          <Copy className="mr-2 h-3.5 w-3.5" />Clone
                        </DropdownMenuItem>
                        <DropdownMenuItem><Download className="mr-2 h-3.5 w-3.5" />Download YAML</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => void handleDelete(cfg.id, cfg.name)}>
                          <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && configs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    No MCP evaluations yet. Create your first one to get started.
                  </TableCell>
                </TableRow>
              )}
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    Loading MCP evaluations...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Configurations;
