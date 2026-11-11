"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Accessibility,
  Building2,
  ClipboardList,
  Flag,
  Layers,
  LogIn,
  LogOut,
  Map as MapIcon,
  Route,
  Settings,
  Share,
} from "lucide-react";
import { BasemapToggle } from "@/components/basemap-toggle";
import { HomeLogo } from "@/components/home-logo";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { BasemapId } from "@/hooks/use-basemap";
import { authClient } from "@/lib/auth-client";
import {
  borderMutedClass,
  mapHeaderChipClass,
  surfacePanelClass,
} from "@/lib/panel-classes";

type EditorToolsMenuProps = {
  isAdmin: boolean;
  isIcUser: boolean;
  isSignedIn?: boolean;
  devMode?: boolean;
  chipClassName?: string;
  chipLabel?: string;
  userName?: string | null;
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
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
  isSignedIn: boolean,
  devMode: boolean,
): ToolLink[] {
  const canUseEditors = isAdmin || devMode;
  const canUseCustomRoutes = isIcUser || devMode;
  const canUseMyMaps = isSignedIn || devMode;

  return [
    {
      href: "/mymaps",
      label: "My Maps",
      description: "Create and share personal campus maps",
      icon: <MapIcon size={22} aria-hidden="true" />,
      show: canUseMyMaps,
    },
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
  compact = false,
  className = "",
}: Omit<ToolLink, "show"> & { compact?: boolean; className?: string }) {
  return (
    <Link
      href={href}
      className={[
        compact
          ? "flex h-9 items-center gap-2 rounded-xl border px-3 text-left text-sm transition"
          : "flex min-h-11 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition",
        "cursor-pointer",
        borderMutedClass,
        surfacePanelClass,
        "hover:bg-panel-muted",
        className,
      ].join(" ")}
    >
      <span className="text-brand-cta">{icon}</span>
      <span className="min-w-0">
        <span className={compact ? "block font-semibold" : "block text-sm font-semibold"}>
          {label}
        </span>
        {compact ? null : (
          <span className="block text-xs text-panel-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </Link>
  );
}

function ReportButton() {
  return (
    <Link
      href="/report"
      className={[
        "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition",
        "border-orange-500/70 bg-orange-500/10 hover:bg-orange-500/20",
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
        "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition",
        "border-brand-cta/70 bg-brand-cta/10 hover:bg-brand-cta/20",
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
  isSignedIn = false,
  devMode = false,
  chipClassName = mapHeaderChipClass,
  chipLabel,
  userName = null,
  basemap,
  onBasemapChange,
}: EditorToolsMenuProps) {
  const router = useRouter();
  const links = useToolLinks(isAdmin, isIcUser, isSignedIn, devMode);

  const chipClass = chipLabel
    ? chipClassName
    : `${chipClassName} shrink-0 px-2`;

  async function signOut() {
    await authClient.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open IC Maps menu"
          className={chipClass}
        >
          <HomeLogo />
          {chipLabel ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide">
              {chipLabel}
            </span>
          ) : null}
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(100vw-2rem,20rem)] gap-0 overflow-hidden rounded-r-2xl border-r [&_a]:cursor-pointer [&_button]:cursor-pointer"
      >
        <SheetHeader className="shrink-0 text-left">
          <SheetTitle>IC Maps</SheetTitle>
          <SheetDescription>
            Campus navigation and editor tools
          </SheetDescription>
        </SheetHeader>
        <nav
          aria-label="Editor tools"
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4"
        >
          {links.map((link) => (
            <ToolLinkButton key={link.href} {...link} />
          ))}
          <BasemapToggle
            variant="menu"
            basemap={basemap}
            onChange={onBasemapChange}
          />
          <ThemeToggleButton variant="menu" />
          {isSignedIn ? (
            <ToolLinkButton
              compact
              href="/account/setting"
              label="Settings"
              description="Profile, favorites, and account"
              icon={<Settings size={16} aria-hidden="true" />}
            />
          ) : null}
          <div className="my-1 border-t border-border" aria-hidden="true" />
          <ReportButton />
          <AccessibilityReportButton />
        </nav>
        <SheetFooter className="shrink-0 border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
          {isSignedIn ? (
            <>
              {userName ? (
                <p className="truncate text-sm text-panel-muted-foreground">
                  Signed in as {userName}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void signOut()}
                className={[
                  "flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                  borderMutedClass,
                  surfacePanelClass,
                  "hover:bg-panel-muted",
                ].join(" ")}
              >
                <LogOut size={18} aria-hidden="true" />
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/account/login"
              className={[
                "flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                borderMutedClass,
                surfacePanelClass,
                "hover:bg-panel-muted",
              ].join(" ")}
            >
              <LogIn size={18} aria-hidden="true" />
              Sign in
            </Link>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
