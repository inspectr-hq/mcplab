import { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Save, Server, Bot, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useConfigs } from "@/contexts/ConfigContext";
import { ServerForm } from "@/components/config-editor/ServerForm";
import { AgentForm } from "@/components/config-editor/AgentForm";
import { ScenarioForm } from "@/components/config-editor/ScenarioForm";
import { toast } from "@/hooks/use-toast";
import type { EvalConfig } from "@/types/eval";

const emptyConfig = (): EvalConfig => ({
  id: `cfg-${Date.now()}`,
  name: "",
  description: "",
  servers: [],
  agents: [],
  scenarios: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const ConfigEditor = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getConfig, addConfig, updateConfig } = useConfigs();

  const isNew = id === "new";
  const isView = !isNew && !!id;
  const existing = isView ? getConfig(id!) : undefined;

  const [editing, setEditing] = useState(isNew);
  const [config, setConfig] = useState<EvalConfig>(() =>
    existing ? structuredClone(existing) : emptyConfig()
  );

  const patch = (updates: Partial<EvalConfig>) => setConfig((c) => ({ ...c, ...updates }));

  const readOnly = !editing;

  const handleSave = () => {
    if (!config.name.trim()) {
      toast({ title: "Validation Error", description: "Configuration name is required.", variant: "destructive" });
      return;
    }
    config.updatedAt = new Date().toISOString();
    if (isNew) {
      addConfig(config);
      toast({ title: "Configuration Created", description: `"${config.name}" has been saved.` });
      navigate(`/configs/${config.id}`);
    } else {
      updateConfig(config.id, config);
      toast({ title: "Configuration Updated", description: `"${config.name}" has been updated.` });
      setEditing(false);
    }
  };

  const title = isNew ? "New Configuration" : editing ? `Editing: ${config.name}` : config.name;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link to="/configs"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {isNew ? "Create a new evaluation configuration" : existing ? `Last updated ${new Date(config.updatedAt).toLocaleDateString()}` : "Configuration not found"}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {isView && !editing && (
            <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
          )}
          {editing && (
            <>
              {!isNew && (
                <Button variant="outline" size="sm" onClick={() => { setConfig(structuredClone(existing!)); setEditing(false); }}>Cancel</Button>
              )}
              <Button size="sm" onClick={handleSave}>
                <Save className="mr-1.5 h-3.5 w-3.5" />Save
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4">
        <Badge variant="outline" className="gap-1.5 py-1 px-3 text-xs">
          <Server className="h-3 w-3" />{config.servers.length} server{config.servers.length !== 1 ? "s" : ""}
        </Badge>
        <Badge variant="outline" className="gap-1.5 py-1 px-3 text-xs">
          <Bot className="h-3 w-3" />{config.agents.length} agent{config.agents.length !== 1 ? "s" : ""}
        </Badge>
        <Badge variant="outline" className="gap-1.5 py-1 px-3 text-xs">
          <FileText className="h-3 w-3" />{config.scenarios.length} scenario{config.scenarios.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Meta fields */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Configuration Name</Label>
              <Input value={config.name} onChange={(e) => patch({ name: e.target.value })} disabled={readOnly} placeholder="e.g. Basic OpenAI Eval" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Input value={config.description || ""} onChange={(e) => patch({ description: e.target.value })} disabled={readOnly} placeholder="Brief description..." />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabbed sections */}
      <Tabs defaultValue="servers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="servers" className="gap-1.5"><Server className="h-3.5 w-3.5" />Servers</TabsTrigger>
          <TabsTrigger value="agents" className="gap-1.5"><Bot className="h-3.5 w-3.5" />Agents</TabsTrigger>
          <TabsTrigger value="scenarios" className="gap-1.5"><FileText className="h-3.5 w-3.5" />Scenarios</TabsTrigger>
        </TabsList>

        <TabsContent value="servers">
          <ServerForm servers={config.servers} onChange={(servers) => patch({ servers })} readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="agents">
          <AgentForm agents={config.agents} onChange={(agents) => patch({ agents })} readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="scenarios">
          <ScenarioForm scenarios={config.scenarios} agents={config.agents} servers={config.servers} onChange={(scenarios) => patch({ scenarios })} readOnly={readOnly} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ConfigEditor;
