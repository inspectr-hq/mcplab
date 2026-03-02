import { useMemo } from "react";
import { LayoutDashboard, Settings, Play, BarChart3, NotepadText, NotebookTabs, GitCompare, Database, Bot, FileCode, FlaskConical, Microscope, ShieldCheck, Github } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import IconInspectr from "@/components/ui/IconInspectr.jsx";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarSeparator,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const navSections = [
  {
    title: "Home",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },

    ]
  },
  {
    title: "Lab",
    items: [
      { title: "MCP Evaluations", url: "/mcp-evaluations", icon: FlaskConical },
      { title: "Analyze MCP", url: "/tool-analysis", icon: Microscope },
      // { title: "OAuth Debugger", url: "/oauth-debugger", icon: ShieldCheck }
    ]
  },
  {
    title: "Libraries",
    items: [
      { title: "Scenarios", url: "/libraries/scenarios", icon: FileCode },
      { title: "Servers", url: "/libraries/servers", icon: Database },
      { title: "Agents", url: "/libraries/agents", icon: Bot },
    ]
  },
  {
    title: "Execution",
    items: [
      { title: "Run Evaluation", url: "/run", icon: Play },
      { title: "Evaluation Results", url: "/results", icon: BarChart3 },
      { title: "Compare Evaluations", url: "/compare", icon: GitCompare },
      { title: "MCP Analysis Results", url: "/tool-analysis-results", icon: NotebookTabs },
      { title: "Custom Reports", url: "/markdown-reports", icon: NotepadText },
    ]
  },
  {
    title: "Workspace",
    items: [{ title: "Settings", url: "/settings", icon: Settings }]
  }
] as const;

interface AppSidebarProps {
  version: string | null;
}

export function AppSidebar(props: AppSidebarProps = { version: null }) {
  const appVersion = props.version ?? null;
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const sections = useMemo(
    () => navSections,
    []
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={`border-b border-sidebar-border py-3 ${collapsed ? "px-2" : "px-4"}`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-2.5"} overflow-hidden`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent/50 border border-primary/60">
            <IconInspectr width={22} height={22} from="#f97316" to="#fb923c" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">MCPLab</span>
              <span className="text-xs text-muted-foreground">MCP Evaluation Lab</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section, sectionIndex) => (
          <div key={section.title}>
            {sectionIndex > 0 && !collapsed && <SidebarSeparator className="my-1.5" />}
            <SidebarGroup className={collapsed ? "px-2" : "px-3 py-2"}>
              {!collapsed && (
                <SidebarGroupLabel className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/90">
                  {section.title}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={
                          item.url === "/"
                            ? location.pathname === "/"
                            : location.pathname.startsWith(item.url)
                        }
                        tooltip={item.title}
                      >
                        <NavLink
                          to={item.url}
                          end={item.url === "/"}
                          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        ))}
      </SidebarContent>
      <SidebarFooter className={collapsed ? "px-2 py-2" : "px-3 py-3"}>
        <SidebarSeparator className="my-1.5" />
        <div className={`flex ${collapsed ? "justify-center" : "items-center justify-center gap-2"} w-full`}>
          <a
            href="https://github.com/inspectr-hq/mcp-lab"
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center rounded-md border border-sidebar-border/70 bg-sidebar-accent/20 text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent/35 hover:text-sidebar-foreground ${
              collapsed ? "justify-center p-2" : "gap-2 px-2.5 py-1.5"
            }`}
            title={`GitHub${appVersion ? ` · v${appVersion}` : ""}`}
            aria-label="GitHub repository"
          >
            <Github className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <span className="text-xs text-sidebar-foreground/85">
                {`v${appVersion ?? "unknown"}`}
              </span>
            )}
          </a>
          {!collapsed && (
            <a
              href="https://inspectr.dev"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground transition-colors hover:text-sidebar-foreground"
            >
              Built by <span className="text-[#00e5ff] hover:text-[#00b8d4]">Inspectr</span>
            </a>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
