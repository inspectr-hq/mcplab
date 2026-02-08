import { Card, CardContent } from "@/components/ui/card";
import { ScenarioForm } from "@/components/config-editor/ScenarioForm";
import { useLibraries } from "@/contexts/LibraryContext";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

const ManageScenarios = () => {
  const { scenarios, setScenarios, agents, servers, reload, loading } = useLibraries();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Manage Scenarios</h1>
          <p className="text-sm text-muted-foreground">
            Reusable scenario templates shared across configurations.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          <ScenarioForm
            scenarios={scenarios}
            agents={agents}
            servers={servers}
            onChange={(next) => { void setScenarios(next); }}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default ManageScenarios;
