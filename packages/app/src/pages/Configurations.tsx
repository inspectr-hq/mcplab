import { Link, useNavigate } from "react-router-dom";
import { Plus, Upload, MoreHorizontal, Copy, Trash2, Download, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfigs } from "@/contexts/ConfigContext";
import { toast } from "@/hooks/use-toast";

const Configurations = () => {
  const { configs, deleteConfig, cloneConfig } = useConfigs();
  const navigate = useNavigate();

  const handleDelete = (id: string, name: string) => {
    deleteConfig(id);
    toast({ title: "Deleted", description: `"${name}" has been removed.` });
  };

  const handleClone = (id: string) => {
    const cloned = cloneConfig(id);
    toast({ title: "Cloned", description: `Created "${cloned.name}".` });
    navigate(`/configs/${cloned.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Configurations</h1>
          <p className="text-sm text-muted-foreground">Manage your evaluation configurations</p>
        </div>
        <div className="flex gap-2">
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
                <TableHead>Name</TableHead>
                <TableHead>Scenarios</TableHead>
                <TableHead>Agents</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {configs.map((cfg) => (
                <TableRow key={cfg.id}>
                  <TableCell>
                    <div>
                      <Link to={`/configs/${cfg.id}`} className="font-medium text-sm hover:text-primary">{cfg.name}</Link>
                      {cfg.description && <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{cfg.scenarios.length}</TableCell>
                  <TableCell className="font-mono text-sm">{cfg.agents.length}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
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
                        <DropdownMenuItem onClick={() => handleClone(cfg.id)}>
                          <Copy className="mr-2 h-3.5 w-3.5" />Clone
                        </DropdownMenuItem>
                        <DropdownMenuItem><Download className="mr-2 h-3.5 w-3.5" />Download YAML</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(cfg.id, cfg.name)}>
                          <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {configs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    No configurations yet. Create your first one to get started.
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
