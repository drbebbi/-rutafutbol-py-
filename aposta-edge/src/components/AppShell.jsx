import React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  LayoutDashboard, TrendingUp, Bot, BarChart3, Settings, Shield, LogOut, Menu,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/value", label: "Value Signals", icon: TrendingUp },
  { to: "/edge-ai", label: "Edge Analyst", icon: Bot },
  { to: "/performance", label: "Performance", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/admin", label: "Admin", icon: Shield },
];

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const initials = (user?.full_name || user?.email || "U").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* Sidebar - desktop */}
      <aside className="hidden md:flex md:w-60 md:flex-col border-r border-border bg-sidebar">
        <div className="flex items-center gap-2 px-5 h-16 border-b border-border">
          <div className="w-8 h-8 rounded-md bg-chart-1 flex items-center justify-center text-primary-foreground font-bold text-sm">AE</div>
          <span className="font-heading font-semibold">Aposta Edge AI</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link key={item.to} to={item.to} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"}`}>
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 px-2 py-1 mb-2">
            <Avatar className="w-8 h-8"><AvatarFallback className="text-xs">{initials}</AvatarFallback></Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{user?.full_name || "User"}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => logout()}>
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between h-14 px-4 border-b border-border sticky top-0 bg-background z-30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-chart-1 flex items-center justify-center text-primary-foreground font-bold text-xs">AE</div>
          <span className="font-heading font-semibold text-sm">Aposta Edge AI</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen((o) => !o)}><Menu className="w-5 h-5" /></Button>
      </header>

      {mobileOpen && (
        <div className="md:hidden border-b border-border bg-sidebar p-3 space-y-1" onClick={() => setMobileOpen(false)}>
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link key={item.to} to={item.to} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70"}`}>
                <item.icon className="w-4 h-4" />{item.label}
              </Link>
            );
          })}
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => logout()}><LogOut className="w-4 h-4 mr-2" />Sign out</Button>
        </div>
      )}

      <main className="flex-1 min-w-0">
        <div className="p-4 md:p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}