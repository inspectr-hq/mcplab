import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Plus, Pencil, Copy, Trash2 } from "lucide-react";
import { useLibraries } from "@/contexts/LibraryContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import type { ServerConfig } from "@/types/eval";

const Servers = () => {
  const { servers, setServers, reload, loading } = useLibraries();
  const navigate = useNavigate();
  const [pendingDelete, setPendingDelete] = useState<ServerConfig | null>(null);

  const handleDuplicate = async (server: ServerConfig) => {
    const baseName = `${server.name}-copy`;
    let newName = baseName;
    let suffix = 1;
    while (servers.some((s) => s.name === newName)) {
      newName = `${baseName}-${suffix}`;
      suffix += 1;
    }
    const duplicate: ServerConfig = {
      ...structuredClone(server),
      id: `srv-${Date.now()}`,
      name: newName,
    };
    await setServers([...servers, duplicate]);
    toast({ title: "Server duplicated", description: `Created ${newName}.` });
  };

  const handleDelete = async (server: ServerConfig) => {
    await setServers(servers.filter((s) => s.id !== server.id));
    toast({ title: "Server deleted", description: `${server.name} was removed.` });
    setPendingDelete(null);
  };

  const getEndpointDisplay = (server: ServerConfig) => {
    if (server.transport === "stdio") {
      return [server.command, ...(server.args || [])].filter(Boolean).join(" ");
    }
    return server.url || "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Servers</h1>
          <p className="text-sm text-muted-foreground">
            Reusable MCP server definitions shared across configurations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={() => navigate("/libraries/servers/new")}>
            <Plus className="mr-2 h-4 w-4" />
            Add Server
          </Button>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No servers configured. Add one to get started.</p>
          <Button type="button" size="sm" className="mt-4" onClick={() => navigate("/libraries/servers/new")}>
            <Plus className="mr-2 h-4 w-4" />
            Add Server
          </Button>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Auth</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((server) => (
                    <TableRow
                      key={server.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/libraries/servers/${encodeURIComponent(server.name)}`)}
                    >
                      <TableCell className="font-medium">{server.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {server.transport}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {getEndpointDisplay(server)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {!server.authType || server.authType === "none" ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {server.authType}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setPendingDelete(server)}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Delete
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void handleDuplicate(server)}
                          >
                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                            Duplicate
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/libraries/servers/${encodeURIComponent(server.name)}`)}
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete server?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <span className="font-mono">{pendingDelete?.name}</span> from the library. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (pendingDelete) void handleDelete(pendingDelete); }}
            >
              Delete Server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Servers;
