"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, LayoutDashboard, ScrollText, ShieldCheck } from "lucide-react";

import OronyxLogomark from "@/components/icons/oronyx-logomark";
import { cn } from "@/lib/utils";

const navigation = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    group: "Overview",
  },
  {
    label: "Agents",
    href: "/agents",
    icon: Bot,
    group: "Management",
  },
  {
    label: "Audit Trail",
    href: "/audit",
    icon: ScrollText,
    group: "Management",
  },
];

export default function AppSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/agents") {
      return pathname === "/agents" || pathname.startsWith("/agents/");
    }

    return pathname === href;
  };

  return (
    <aside className="hidden h-full w-60 shrink-0 border-r border-border/60 bg-sidebar md:flex md:flex-col">
      <div className="flex h-full flex-col">
        {/* Brand */}
        <div className="px-4 pb-5 pt-5">
          <Link
            href="/"
            className="inline-flex rounded-md transition-opacity hover:opacity-90"
          >
            <OronyxLogomark />
          </Link>
        </div>

        {/* Navigation */}
        <div className="flex-1 px-3">
          <SidebarGroup label="Overview">
            {navigation
              .filter((item) => item.group === "Overview")
              .map((item) => (
                <SidebarItem
                  key={item.href}
                  {...item}
                  active={isActive(item.href)}
                />
              ))}
          </SidebarGroup>

          <SidebarGroup label="Management" className="mt-6">
            {navigation
              .filter((item) => item.group === "Management")
              .map((item) => (
                <SidebarItem
                  key={item.href}
                  {...item}
                  active={isActive(item.href)}
                />
              ))}
          </SidebarGroup>
        </div>

        {/* Bottom Status */}
        <div className="p-3">
          <div className="border-t border-border/60 pt-3">
            <div className="rounded-lg border border-border/60 bg-sidebar-accent/30 p-3">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-md bg-primary/10">
                  <ShieldCheck className="size-4 text-primary" />
                </div>

                <div className="min-w-0">
                  <p className="text-xs font-medium text-sidebar-foreground">
                    Protected Session
                  </p>

                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    <span className="text-[11px] text-muted-foreground">
                      Sui connected
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
        {label}
      </p>

      <nav className="space-y-1">{children}</nav>
    </div>
  );
}

function SidebarItem({
  label,
  href,
  icon: Icon,
  active,
}: {
  label: string;
  href: string;
  icon: React.ElementType;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
      )}

      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active
            ? "text-primary"
            : "text-muted-foreground group-hover:text-sidebar-foreground",
        )}
      />

      <span className={cn(active && "font-medium")}>{label}</span>
    </Link>
  );
}
