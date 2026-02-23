import { LayoutDashboard, Settings, Play, BarChart3, GitCompare, Database, Bot, FileCode } from "lucide-react";
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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const navSections = [
  {
    title: "Workspace",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "MCP Evaluations", url: "/configs", icon: Settings }
    ]
  },
  {
    title: "Libraries",
    items: [
      { title: "Servers", url: "/libraries/servers", icon: Database },
      { title: "Agents", url: "/libraries/agents", icon: Bot },
      { title: "Scenarios", url: "/libraries/scenarios", icon: FileCode }
    ]
  },
  {
    title: "Execution",
    items: [
      { title: "Run Evaluation", url: "/run", icon: Play },
      { title: "Results", url: "/results", icon: BarChart3 },
      { title: "Compare", url: "/compare", icon: GitCompare }
    ]
  },
  {
    title: "Application",
    items: [{ title: "Settings", url: "/settings", icon: Settings }]
  }
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent/50 ring-1 ring-sidebar-border">
            <IconInspectr width={22} height={22} from="#f59e0b" to="#facc15" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">MCPLab</span>
              <span className="text-xs text-muted-foreground">Evaluation Manager</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {navSections.map((section, sectionIndex) => (
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
    </Sidebar>
  );
}
