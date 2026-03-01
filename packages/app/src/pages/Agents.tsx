import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Plus, Pencil, Copy, Trash2, Bot } from "lucide-react";
import { useLibraries } from "@/contexts/LibraryContext";
import { Button } from "@/components/ui/button";
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
import { ProviderBadge } from "@/components/ProviderBadge";
import { toast } from "@/hooks/use-toast";
import type { AgentConfig } from "@/types/eval";

const Agents = () => {
  const { agents, setAgents, reload, loading } = useLibraries();
  const navigate = useNavigate();
  const [pendingDelete, setPendingDelete] = useState<AgentConfig | null>(null);

  const handleDuplicate = async (agent: AgentConfig) => {
    const baseName = `${agent.name}-copy`;
    let newName = baseName;
    let suffix = 1;
    while (agents.some((a) => a.name === newName)) {
      newName = `${baseName}-${suffix}`;
      suffix += 1;
    }
    const duplicate: AgentConfig = {
      ...structuredClone(agent),
      id: `agt-${Date.now()}`,
      name: newName,
    };
    await setAgents([...agents, duplicate]);
    toast({ title: "Agent duplicated", description: `Created ${newName}.` });
  };

  const handleDelete = async (agent: AgentConfig) => {
    await setAgents(agents.filter((a) => a.id !== agent.id));
    toast({ title: "Agent deleted", description: `${agent.name} was removed.` });
    setPendingDelete(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <Bot className="h-6 w-6" />
            Agents
          </h1>
          <p className="text-sm text-muted-foreground">
            Reusable agent profiles shared across configurations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={() => navigate("/libraries/agents/new")}>
            <Plus className="mr-2 h-4 w-4" />
            Add Agent
          </Button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No agents configured. Add one to get started.</p>
          <Button type="button" size="sm" className="mt-4" onClick={() => navigate("/libraries/agents/new")}>
            <Plus className="mr-2 h-4 w-4" />
            Add Agent
          </Button>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Max Tokens</TableHead>
                  <TableHead>Temperature</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => (
                  <TableRow
                    key={agent.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/libraries/agents/${encodeURIComponent(agent.name)}`)}
                  >
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell>
                      <ProviderBadge provider={agent.provider} />
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{agent.model}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{agent.maxTokens}</TableCell>
                    <TableCell className="font-mono text-xs">{agent.temperature.toFixed(2)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setPendingDelete(agent)}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Delete
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleDuplicate(agent)}
                        >
                          <Copy className="mr-1.5 h-3.5 w-3.5" />
                          Duplicate
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/libraries/agents/${encodeURIComponent(agent.name)}`)}
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
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
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
              Delete Agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Agents;
