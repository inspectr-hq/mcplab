import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { ConfigProvider } from "@/contexts/ConfigContext";
import { DataSourceProvider } from "@/contexts/DataSourceContext";
import { LibraryProvider } from "@/contexts/LibraryContext";
import Index from "./pages/Index";
import Configurations from "./pages/Configurations";
import ConfigEditor from "./pages/ConfigEditor";
import ManageServers from "./pages/ManageServers";
import ManageAgents from "./pages/ManageAgents";
import ManageScenarios from "./pages/ManageScenarios";
import SettingsPage from "./pages/Settings";
import ToolAnalysis from "./pages/ToolAnalysis";
import RunEvaluation from "./pages/RunEvaluation";
import Results from "./pages/Results";
import ResultDetail from "./pages/ResultDetail";
import Compare from "./pages/Compare";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <DataSourceProvider>
        <LibraryProvider>
          <ConfigProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Index />} />
                  <Route path="/mcp-evaluations" element={<Configurations />} />
                  <Route path="/mcp-evaluations/:id" element={<ConfigEditor />} />
                  <Route path="/mcp-evaluations/:id/:tab" element={<ConfigEditor />} />
                  <Route path="/tool-analysis" element={<ToolAnalysis />} />
                  <Route path="/libraries/servers" element={<ManageServers />} />
                  <Route path="/libraries/agents" element={<ManageAgents />} />
                  <Route path="/libraries/scenarios" element={<ManageScenarios />} />
                  <Route path="/libraries/scenarios/:scenarioId" element={<ManageScenarios />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/run" element={<RunEvaluation />} />
                  <Route path="/results" element={<Results />} />
                  <Route path="/results/:id" element={<ResultDetail />} />
                  <Route path="/compare" element={<Compare />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </ConfigProvider>
        </LibraryProvider>
      </DataSourceProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
