import { lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { ConfigProvider } from '@/contexts/ConfigContext';
import { DataSourceProvider } from '@/contexts/DataSourceContext';
import { LibraryProvider } from '@/contexts/LibraryContext';
const Index = lazy(() => import('./pages/Index'));
const Configurations = lazy(() => import('./pages/Configurations'));
const ConfigEditor = lazy(() => import('./pages/ConfigEditor'));
const Servers = lazy(() => import('./pages/Servers'));
const ServerDetail = lazy(() => import('./pages/ServerDetail'));
const Agents = lazy(() => import('./pages/Agents'));
const AgentDetail = lazy(() => import('./pages/AgentDetail'));
const ManageTestCases = lazy(() => import('./pages/ManageTestCases'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const McpConnectionInfoPage = lazy(() => import('./pages/McpConnectionInfo'));
const ToolAnalysis = lazy(() => import('./pages/ToolAnalysis'));
const ToolAnalysisResults = lazy(() => import('./pages/ToolAnalysisResults'));
const ToolAnalysisResultDetail = lazy(() => import('./pages/ToolAnalysisResultDetail'));
const OAuthDebugger = lazy(() => import('./pages/OAuthDebugger'));
const RunEvaluation = lazy(() => import('./pages/RunEvaluation'));
const Results = lazy(() => import('./pages/Results'));
const ResultDetail = lazy(() => import('./pages/ResultDetail'));
const Compare = lazy(() => import('./pages/Compare'));
const CompareResultDetails = lazy(() => import('./pages/CompareResultDetails'));
const MarkdownReports = lazy(() => import('./pages/MarkdownReports'));
const MarkdownReportDetail = lazy(() => import('./pages/MarkdownReportDetail'));
const NotFound = lazy(() => import('./pages/NotFound'));

const queryClient = new QueryClient();

export function LegacyScenarioRouteRedirect() {
  const { scenarioId } = useParams<{ scenarioId?: string }>();
  return (
    <Navigate
      to={
        scenarioId
          ? `/libraries/test-cases/${encodeURIComponent(scenarioId)}`
          : '/libraries/test-cases'
      }
      replace
    />
  );
}

export function AppRouteTree() {
  return (
    <Suspense
      fallback={
        <div role="status" className="p-6 text-sm text-muted-foreground">
          Loading page...
        </div>
      }
    >
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
          <Route path="/libraries/agents" element={<Agents defaultType="llm" />} />
          <Route path="/libraries/agents/:agentName" element={<AgentDetail />} />
          <Route path="/libraries/test-cases" element={<ManageTestCases />} />
          <Route path="/libraries/test-cases/:testCaseId" element={<ManageTestCases />} />
          <Route
            path="/libraries/scenarios"
            element={<Navigate to="/libraries/test-cases" replace />}
          />
          <Route
            path="/libraries/scenarios/:scenarioId"
            element={<LegacyScenarioRouteRedirect />}
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/mcp" element={<McpConnectionInfoPage />} />
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
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <DataSourceProvider>
        <LibraryProvider>
          <ConfigProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AppRouteTree />
            </BrowserRouter>
          </ConfigProvider>
        </LibraryProvider>
      </DataSourceProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
