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
import Servers from "./pages/Servers";
import ServerDetail from "./pages/ServerDetail";
import Agents from "./pages/Agents";
import AgentDetail from "./pages/AgentDetail";
import ManageScenarios from "./pages/ManageScenarios";
import SettingsPage from "./pages/Settings";
import ToolAnalysis from "./pages/ToolAnalysis";
import ToolAnalysisResults from "./pages/ToolAnalysisResults";
import ToolAnalysisResultDetail from "./pages/ToolAnalysisResultDetail";
import OAuthDebugger from "./pages/OAuthDebugger";
import RunEvaluation from "./pages/RunEvaluation";
import Results from "./pages/Results";
import ResultDetail from "./pages/ResultDetail";
import Compare from "./pages/Compare";
import CompareResultDetails from "./pages/CompareResultDetails";
import MarkdownReports from "./pages/MarkdownReports";
import MarkdownReportDetail from "./pages/MarkdownReportDetail";
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
                  <Route path="/tool-analysis-results" element={<ToolAnalysisResults />} />
                  <Route path="/tool-analysis-results/:id" element={<ToolAnalysisResultDetail />} />
                  <Route path="/oauth-debugger" element={<OAuthDebugger />} />
                  <Route path="/libraries/servers" element={<Servers />} />
                  <Route path="/libraries/servers/:serverId" element={<ServerDetail />} />
                  <Route path="/libraries/agents" element={<Agents />} />
                  <Route path="/libraries/agents/:agentName" element={<AgentDetail />} />
                  <Route path="/libraries/scenarios" element={<ManageScenarios />} />
                  <Route path="/libraries/scenarios/:scenarioId" element={<ManageScenarios />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/run" element={<RunEvaluation />} />
                  <Route path="/results" element={<Results />} />
                  <Route path="/results/:id" element={<ResultDetail />} />
                  <Route path="/markdown-reports" element={<MarkdownReports />} />
                  <Route path="/markdown-reports/view" element={<MarkdownReportDetail />} />
                  <Route path="/compare" element={<Compare />} />
                  <Route path="/compare/results" element={<CompareResultDetails />} />
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
