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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

  if (matchPath("/configs/:id", pathname)) {
    crumbs.push({ label: "Configurations", to: "/configs" }, { label: "Config" });
    return crumbs;
  }
  if (matchPath("/configs", pathname)) {
    crumbs.push({ label: "Configurations" });
    return crumbs;
  }
  if (matchPath("/results/:id", pathname)) {
    crumbs.push({ label: "Results", to: "/results" }, { label: "Result" });
    return crumbs;
  }
  if (matchPath("/results", pathname)) {
    crumbs.push({ label: "Results" });
    return crumbs;
  }
  if (matchPath("/run", pathname)) {
    crumbs.push({ label: "Run Evaluation" });
    return crumbs;
  }
  if (matchPath("/libraries/servers", pathname)) {
    crumbs.push({ label: "Manage Servers" });
    return crumbs;
  }
  if (matchPath("/libraries/agents", pathname)) {
    crumbs.push({ label: "Manage Agents" });
    return crumbs;
  }
  if (matchPath("/libraries/scenarios", pathname)) {
    crumbs.push({ label: "Manage Scenarios" });
    return crumbs;
  }
  if (matchPath("/compare", pathname)) {
    crumbs.push({ label: "Compare" });
    return crumbs;
  }

  return crumbs;
};

export function AppLayout() {
  const location = useLocation();
  const crumbs = buildCrumbs(location.pathname);
  const { mode, setMode, connection } = useDataSource();

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
              <span className="text-xs text-muted-foreground">Data Source</span>
              <Select value={mode} onValueChange={(value) => setMode(value as "demo" | "workspace")}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="demo">Demo</SelectItem>
                  <SelectItem value="workspace">Workspace</SelectItem>
                </SelectContent>
              </Select>
              {mode === "workspace" && (
                <span className={`text-xs ${connection === "connected" ? "text-success" : connection === "checking" ? "text-muted-foreground" : "text-destructive"}`}>
                  {connection}
                </span>
              )}
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
