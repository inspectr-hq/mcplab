import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useDataSource } from "@/contexts/DataSourceContext";
import { Fragment } from "react";
import { Link, Outlet, matchPath, useLocation } from "react-router-dom";

type Crumb = {
  label: string;
  to?: string;
};

const buildCrumbs = (pathname: string): Crumb[] => {
  if (pathname === "/") {
    return [{ label: "Dashboard" }];
  }

  const crumbs: Crumb[] = [{ label: "Dashboard", to: "/" }];

  if (matchPath("/mcp-evaluations/:id", pathname)) {
    crumbs.push({ label: "MCP Evaluations", to: "/mcp-evaluations" }, { label: "MCP Evaluation" });
    return crumbs;
  }
  if (matchPath("/mcp-evaluations", pathname)) {
    crumbs.push({ label: "MCP Evaluations" });
    return crumbs;
  }
  if (matchPath("/settings", pathname)) {
    crumbs.push({ label: "Settings" });
    return crumbs;
  }
  if (matchPath("/tool-analysis", pathname)) {
    crumbs.push({ label: "Analyze MCP Tools" });
    return crumbs;
  }
  if (matchPath("/tool-analysis-results/:id", pathname)) {
    const match = matchPath("/tool-analysis-results/:id", pathname);
    crumbs.push(
      { label: "Tool Analysis Results", to: "/tool-analysis-results" },
      { label: match?.params.id ?? "Report" }
    );
    return crumbs;
  }
  if (matchPath("/tool-analysis-results", pathname)) {
    crumbs.push({ label: "Tool Analysis Results" });
    return crumbs;
  }
  if (matchPath("/markdown-reports/view", pathname)) {
    crumbs.push({ label: "Markdown Reports", to: "/markdown-reports" }, { label: "View Report" });
    return crumbs;
  }
  if (matchPath("/markdown-reports", pathname)) {
    crumbs.push({ label: "Markdown Reports" });
    return crumbs;
  }
  if (matchPath("/oauth-debugger", pathname)) {
    crumbs.push({ label: "OAuth Debugger" });
    return crumbs;
  }
  if (matchPath("/results/:id", pathname)) {
    crumbs.push({ label: "Evaluation Results", to: "/results" }, { label: "Result" });
    return crumbs;
  }
  if (matchPath("/results", pathname)) {
    crumbs.push({ label: "Evaluation Results" });
    return crumbs;
  }
  if (matchPath("/run", pathname)) {
    crumbs.push({ label: "Run Evaluation" });
    return crumbs;
  }
  if (matchPath("/libraries/servers/:serverName", pathname)) {
    const match = matchPath("/libraries/servers/:serverName", pathname);
    const serverName = match?.params.serverName
      ? decodeURIComponent(match.params.serverName)
      : "Server";
    crumbs.push(
      { label: "Libraries", to: "/libraries/servers" },
      { label: "Servers", to: "/libraries/servers" },
      { label: serverName === "new" ? "New Server" : serverName }
    );
    return crumbs;
  }
  if (matchPath("/libraries/servers", pathname)) {
    crumbs.push({ label: "Libraries", to: "/libraries/servers" }, { label: "Servers" });
    return crumbs;
  }
  if (matchPath("/libraries/agents/:agentName", pathname)) {
    const match = matchPath("/libraries/agents/:agentName", pathname);
    const agentName = match?.params.agentName
      ? decodeURIComponent(match.params.agentName)
      : "Agent";
    crumbs.push(
      { label: "Libraries", to: "/libraries/agents" },
      { label: "Agents", to: "/libraries/agents" },
      { label: agentName === "new" ? "New Agent" : agentName }
    );
    return crumbs;
  }
  if (matchPath("/libraries/agents", pathname)) {
    crumbs.push({ label: "Libraries", to: "/libraries/agents" }, { label: "Agents" });
    return crumbs;
  }
  if (matchPath("/libraries/scenarios/:scenarioId", pathname)) {
    const match = matchPath("/libraries/scenarios/:scenarioId", pathname);
    const scenarioId = match?.params.scenarioId ? decodeURIComponent(match.params.scenarioId) : "Scenario";
    crumbs.push(
      { label: "Libraries", to: "/libraries/scenarios" },
      { label: "Scenarios", to: "/libraries/scenarios" },
      { label: scenarioId }
    );
    return crumbs;
  }
  if (matchPath("/libraries/scenarios", pathname)) {
    crumbs.push({ label: "Libraries", to: "/libraries/scenarios" }, { label: "Scenarios" });
    return crumbs;
  }
  if (matchPath("/compare", pathname)) {
    crumbs.push({ label: "Compare Evaluations" });
    return crumbs;
  }
  if (matchPath("/compare/results", pathname)) {
    crumbs.push({ label: "Compare Evaluations", to: "/compare" }, { label: "Full Result Compare" });
    return crumbs;
  }

  return crumbs;
};

export function AppLayout() {
  const location = useLocation();
  const embed = new URLSearchParams(location.search).get("embed") === "1";
  const crumbs = buildCrumbs(location.pathname);
  const { connection } = useDataSource();

  if (embed) {
    return (
      <main className="min-h-screen overflow-auto bg-background p-4">
        <Outlet />
      </main>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-12 items-center gap-2 border-b bg-card px-4">
            <SidebarTrigger />
            <Breadcrumb>
              <BreadcrumbList>
                {crumbs.map((crumb, index) => {
                  const isLast = index === crumbs.length - 1;
                  return (
                    <Fragment key={`${crumb.label}-${index}`}>
                      <BreadcrumbItem>
                        {crumb.to && !isLast ? (
                          <BreadcrumbLink asChild>
                            <Link to={crumb.to}>{crumb.label}</Link>
                          </BreadcrumbLink>
                        ) : (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        )}
                      </BreadcrumbItem>
                      {!isLast && <BreadcrumbSeparator />}
                    </Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto flex items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1">
                <span
                  className={`h-2 w-2 rounded-full ${
                    connection === "connected"
                      ? "bg-emerald-500"
                      : connection === "checking"
                        ? "bg-amber-400"
                        : "bg-rose-500"
                  }`}
                  aria-hidden="true"
                />
                <span
                  className={`text-xs ${
                    connection === "connected"
                      ? "text-emerald-700"
                      : connection === "checking"
                        ? "text-muted-foreground"
                        : "text-destructive"
                  }`}
                >
                  {connection}
                </span>
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
