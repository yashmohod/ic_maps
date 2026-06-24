"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Accessibility,
  Building2,
  ClipboardList,
  Flag,
  Layers,
  Route,
  Share,
} from "lucide-react";
import { HomeLogo } from "@/components/home-logo";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  borderMutedClass,
  mapHeaderChipClass,
  surfacePanelClass,
} from "@/lib/panel-classes";

type EditorToolsMenuProps = {
  isAdmin: boolean;
  isIcUser: boolean;
  devMode?: boolean;
  chipClassName?: string;
};

type ToolLink = {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
  show: boolean;
};

function useToolLinks(
  isAdmin: boolean,
  isIcUser: boolean,
  devMode: boolean,
): ToolLink[] {
  const canUseEditors = isAdmin || devMode;
  const canUseCustomRoutes = isIcUser || devMode;

  return [
    {
      href: "/route-editor",
      label: "Route Editor",
      description: "Edit outdoor paths, nodes, and nav flags",
      icon: <Route size={22} aria-hidden="true" />,
      show: canUseEditors,
    },
    {
      href: "/destination-editor",
      label: "Destination Editor",
      description: "Edit buildings, polygons, and floor plans",
      icon: <Building2 size={22} aria-hidden="true" />,
      show: canUseEditors,
    },
    {
      href: "/destination-editor/floorplan",
      label: "Floor Plan Editor",
      description: "Edit indoor floors, nodes, and connections",
      icon: <Layers size={22} aria-hidden="true" />,
      show: canUseEditors,
    },
    {
      href: "/admin/reports",
      label: "Reports",
      description: "Review bug, accessibility, and route reports",
      icon: <ClipboardList size={22} aria-hidden="true" />,
      show: canUseEditors,
    },
    {
      href: "/customRoute",
      label: "Shareable Routes",
      description: "Create and manage shareable routes",
      icon: <Share size={22} aria-hidden="true" />,
      show: canUseCustomRoutes,
    },
  ].filter((item) => item.show);
}

function ToolLinkButton({
  href,
  label,
  description,
  icon,
  className = "",
}: Omit<ToolLink, "show"> & { className?: string }) {
  return (
    <Link
      href={href}
      className={[
        "flex min-h-11 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition",
        borderMutedClass,
        surfacePanelClass,
        "hover:bg-panel",
        className,
      ].join(" ")}
    >
      <span className="text-brand-cta">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-panel-muted-foreground">
          {description}
        </span>
      </span>
    </Link>
  );
}

function ReportButton() {
  return (
    <Link
      href="/report"
      className={[
        "flex min-h-11 w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition",
        "border-orange-500/70 bg-orange-500/10 hover:bg-orange-500/15",
        "ring-1 ring-orange-500/20",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50",
      ].join(" ")}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-orange-600 dark:text-orange-400">
        <Flag size={20} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-orange-950 dark:text-orange-50">
          Report an issue
        </span>
        <span className="block text-xs text-orange-900/75 dark:text-orange-100/75">
          Flag map problems, bad routes, or missing places
        </span>
      </span>
    </Link>
  );
}

function AccessibilityReportButton() {
  return (
    <Link
      href="/report/accessibility"
      className={[
        "flex min-h-11 w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition",
        "border-brand-cta/70 bg-brand-cta/10 hover:bg-brand-cta/15",
        "ring-1 ring-brand-cta/20",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-cta/50",
      ].join(" ")}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-cta/20 text-brand-cta">
        <Accessibility size={20} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-teal-950 dark:text-teal-50">
          Accessibility report
        </span>
        <span className="block text-xs text-teal-900/75 dark:text-teal-100/75">
          Report barriers using IC Maps
        </span>
      </span>
    </Link>
  );
}

export function EditorToolsMenu({
  isAdmin,
  isIcUser,
  devMode = false,
  chipClassName = mapHeaderChipClass,
}: EditorToolsMenuProps) {
  const links = useToolLinks(isAdmin, isIcUser, devMode);

  const chipClass = `${chipClassName} shrink-0 px-2`;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open IC Maps menu"
          className={chipClass}
        >
          <HomeLogo />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(100vw-2rem,20rem)] rounded-r-2xl border-r"
      >
        <SheetHeader className="text-left">
          <SheetTitle>IC Maps</SheetTitle>
          <SheetDescription>
            Campus navigation and editor tools
          </SheetDescription>
        </SheetHeader>
        <nav
          aria-label="Editor tools"
          className="flex flex-col gap-2 px-4 pb-4"
        >
          {links.map((link) => (
            <ToolLinkButton key={link.href} {...link} />
          ))}
          {links.length > 0 ? (
            <div className="my-1 border-t border-border" aria-hidden="true" />
          ) : null}
          <ReportButton />
          <AccessibilityReportButton />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
