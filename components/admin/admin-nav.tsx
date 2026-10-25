"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Globe,
  Hammer,
  Network,
  ShieldAlert,
  Activity,
  ScrollText,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/websites", label: "Websites", icon: Globe },
  { href: "/admin/builds", label: "Builds", icon: Hammer },
  { href: "/admin/domains", label: "Domains", icon: Network },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  { href: "/admin/system", label: "System", icon: Activity },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col" aria-label="Admin sections">
      {SECTIONS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            active(href)
              ? "bg-pine-900 text-gold-400"
              : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900"
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
