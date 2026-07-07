"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";

import { RouteReportFloorplanPreview } from "@/components/admin-reports/route-report-floorplan-preview";
import { RouteReportOutdoorPreview } from "@/components/admin-reports/route-report-outdoor-preview";
import { ReportDateFilter } from "@/components/admin-reports/report-date-filter";
import {
  DeadFeaturesPanel,
  markRouteReportFeatureDead,
  routeReportDeadTarget,
} from "@/components/admin-reports/dead-features-panel";
import { HomeLogo } from "@/components/home-logo";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRequireAdmin } from "@/hooks/use-require-admin";
import apiClient from "@/lib/apiClient";
import { withBasePath } from "@/lib/base-path";
import {
  buildReportDateQueryString,
  DEFAULT_REPORT_DATE_FILTER,
  isCustomRangeComplete,
  type ReportDateFilterValue,
} from "@/lib/report-date-filter";
import {
  isIndoorRouteReport,
  LOCATION_TYPE_ITEMS,
  routeReportFeatureGroupKey,
  routeReportFeatureGroupLabel,
} from "@/lib/route-report";
import { cn } from "@/lib/utils";

type ReportTab = "bug" | "accessibility" | "route";

type BugReportRow = {
  id: number;
  text: string;
  photoPath: string | null;
  createdAt: string;
};

type AccessibilityReportRow = {
  id: number;
  text: string;
  photoPath: string | null;
  createdAt: string;
  userId: string | null;
  userEmail: string | null;
};

type RouteReportRow = {
  id: number;
  text: string | null;
  locationType: string;
  destinationId: number | null;
  destinationName: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  destinationPolygon: string | null;
  featureType: string | null;
  nodeOutsideId: number | null;
  nodeOutsideLat: number | null;
  nodeOutsideLng: number | null;
  nodeInsideId: number | null;
  nodeInsideX: number | null;
  nodeInsideY: number | null;
  nodeInsideName: string | null;
  pinLat: number | null;
  pinLng: number | null;
  createdAt: string;
  userId: string | null;
  userEmail: string | null;
};

const TAB_ITEMS: Array<{ id: ReportTab; label: string }> = [
  { id: "bug", label: "Bug" },
  { id: "accessibility", label: "Accessibility" },
  { id: "route", label: "Route" },
];

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function previewText(text: string | null | undefined, max = 80) {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return "—";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function labelFor(
  items: Array<{ value: string; label: string }>,
  value: string | null | undefined,
) {
  if (!value) return "—";
  return items.find((item) => item.value === value)?.label ?? value;
}

function ReportsTable({
  children,
  emptyMessage,
  isEmpty,
}: {
  children: ReactNode;
  emptyMessage: string;
  isEmpty: boolean;
}) {
  if (isEmpty) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[640px] text-left text-sm">
        {children}
      </table>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "bg-brand px-4 py-3 text-start text-sm font-semibold text-brand-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("border-t border-border px-4 py-3 align-top", className)}>
      {children}
    </td>
  );
}

function ReportTabBar({
  activeTab,
  onChange,
}: {
  activeTab: ReportTab;
  onChange: (tab: ReportTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Report type"
      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
    >
      {TAB_ITEMS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold transition",
              isActive
                ? "border-brand-cta bg-brand-cta text-brand-cta-foreground"
                : "border-border bg-panel hover:bg-panel/80",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminReportsPage() {
  const { allowed, isPending } = useRequireAdmin();
  const [activeTab, setActiveTab] = useState<ReportTab>("bug");
  const [loading, setLoading] = useState(true);
  const [bugReports, setBugReports] = useState<BugReportRow[]>([]);
  const [accessibilityReports, setAccessibilityReports] = useState<
    AccessibilityReportRow[]
  >([]);
  const [routeReports, setRouteReports] = useState<RouteReportRow[]>([]);
  const [selectedRouteReportId, setSelectedRouteReportId] = useState<
    number | null
  >(null);
  const [dateFilter, setDateFilter] = useState<ReportDateFilterValue>(
    DEFAULT_REPORT_DATE_FILTER,
  );
  const [deadListRefreshKey, setDeadListRefreshKey] = useState(0);
  const [markingDead, setMarkingDead] = useState(false);

  const dateQuery = useMemo(() => {
    if (!isCustomRangeComplete(dateFilter)) return "";
    return buildReportDateQueryString(dateFilter);
  }, [dateFilter]);

  useEffect(() => {
    if (!allowed) return;
    if (dateFilter.preset === "custom" && !dateFilter.from) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const [bugResp, a11yResp, routeResp] = await Promise.all([
          apiClient.get(`/api/report/bug${dateQuery}`),
          apiClient.get(`/api/report/accessibility${dateQuery}`),
          apiClient.get(`/api/report/route${dateQuery}`),
        ]);

        if (!bugResp.ok || !a11yResp.ok || !routeResp.ok) {
          throw new Error("Failed to load reports");
        }

        const [bugPayload, a11yPayload, routePayload] = await Promise.all([
          bugResp.json(),
          a11yResp.json(),
          routeResp.json(),
        ]);

        if (cancelled) return;

        setBugReports(
          Array.isArray(bugPayload?.reports)
            ? (bugPayload.reports as BugReportRow[])
            : [],
        );
        setAccessibilityReports(
          Array.isArray(a11yPayload?.reports)
            ? (a11yPayload.reports as AccessibilityReportRow[])
            : [],
        );
        const routes = Array.isArray(routePayload?.reports)
          ? (routePayload.reports as RouteReportRow[])
          : [];
        setRouteReports(routes);
        setSelectedRouteReportId(routes[0]?.id ?? null);
      } catch {
        if (!cancelled) toast.error("Failed to load reports");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, dateQuery, dateFilter.preset, dateFilter.from, dateFilter.to]);

  const selectedRouteReport = useMemo(
    () =>
      routeReports.find((report) => report.id === selectedRouteReportId) ??
      null,
    [routeReports, selectedRouteReportId],
  );

  const groupedRouteReports = useMemo(() => {
    const groups = new Map<string, RouteReportRow[]>();
    for (const report of routeReports) {
      const key = routeReportFeatureGroupKey(report);
      const list = groups.get(key) ?? [];
      list.push(report);
      groups.set(key, list);
    }

    return [...groups.entries()]
      .map(([key, reports]) => {
        const sorted = [...reports].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        return {
          key,
          label: routeReportFeatureGroupLabel(sorted[0]),
          reports: sorted,
        };
      })
      .sort((a, b) => b.reports.length - a.reports.length);
  }, [routeReports]);

  const selectedDeadTarget = useMemo(
    () =>
      selectedRouteReport
        ? routeReportDeadTarget(selectedRouteReport, isIndoorRouteReport)
        : null,
    [selectedRouteReport],
  );

  const handleMarkSelectedDead = async () => {
    if (!selectedDeadTarget) return;
    setMarkingDead(true);
    try {
      const lists = await markRouteReportFeatureDead(selectedDeadTarget, true);
      if (!lists) {
        toast.error("Could not mark feature as dead");
        return;
      }
      setDeadListRefreshKey((key) => key + 1);
      toast.success("Feature added to dead list");
    } catch {
      toast.error("Could not mark feature as dead");
    } finally {
      setMarkingDead(false);
    }
  };

  if (isPending || !allowed) {
    return (
      <div className="grid min-h-svh place-items-center bg-background text-foreground">
        <Spinner className="text-brand-cta" />
      </div>
    );
  }

  return (
    <main
      id="main-content"
      className="bg-background text-foreground flex min-h-svh w-full flex-col items-center gap-6 p-6 md:p-10"
    >
      <div className="flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2 font-medium"
          >
            <span className="border-border bg-panel inline-flex shrink-0 items-center justify-center rounded-[25px] border px-2 py-1 shadow-lg">
              <HomeLogo />
            </span>
            <h1 className="truncate text-base font-medium">
              Ithaca College Map
            </h1>
          </Link>
          <ThemeToggleButton className="h-10 w-10 shrink-0" />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ClipboardList
              className="size-5 shrink-0 text-brand-cta"
              aria-hidden="true"
            />
            <h2 className="text-xl font-semibold leading-none">Reports</h2>
          </div>
          <p className="text-muted-foreground text-sm">
            Admin view of bug, accessibility, and route reports submitted from
            the map.
          </p>
        </div>

        <ReportTabBar activeTab={activeTab} onChange={setActiveTab} />

        <ReportDateFilter value={dateFilter} onChange={setDateFilter} />

        {loading ? (
          <Card>
            <CardContent className="flex justify-center py-16">
              <Spinner className="text-brand-cta" />
            </CardContent>
          </Card>
        ) : activeTab === "bug" ? (
          <Card>
            <CardHeader>
              <CardTitle>Bug reports</CardTitle>
              <CardDescription>
                Issues reported from the map bug report form.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReportsTable
                isEmpty={bugReports.length === 0}
                emptyMessage="No bug reports yet."
              >
                <thead>
                  <tr>
                    <Th>ID</Th>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th>Photo</Th>
                  </tr>
                </thead>
                <tbody>
                  {bugReports.map((report) => (
                    <tr key={report.id}>
                      <Td className="whitespace-nowrap font-mono text-xs">
                        #{report.id}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {formatDate(report.createdAt)}
                      </Td>
                      <Td>{previewText(report.text, 120)}</Td>
                      <Td>
                        {report.photoPath ? (
                          <Link
                            href={withBasePath(report.photoPath)}
                            target="_blank"
                            className="text-brand-cta font-medium hover:underline"
                          >
                            View photo
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </ReportsTable>
            </CardContent>
          </Card>
        ) : activeTab === "accessibility" ? (
          <Card>
            <CardHeader>
              <CardTitle>Accessibility reports</CardTitle>
              <CardDescription>
                Barriers and accessibility issues reported by users.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReportsTable
                isEmpty={accessibilityReports.length === 0}
                emptyMessage="No accessibility reports yet."
              >
                <thead>
                  <tr>
                    <Th>ID</Th>
                    <Th>Date</Th>
                    <Th>User</Th>
                    <Th>Description</Th>
                    <Th>Photo</Th>
                  </tr>
                </thead>
                <tbody>
                  {accessibilityReports.map((report) => (
                    <tr key={report.id}>
                      <Td className="whitespace-nowrap font-mono text-xs">
                        #{report.id}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {formatDate(report.createdAt)}
                      </Td>
                      <Td className="text-xs">{report.userEmail ?? "Guest"}</Td>
                      <Td>{previewText(report.text, 120)}</Td>
                      <Td>
                        {report.photoPath ? (
                          <Link
                            href={withBasePath(report.photoPath)}
                            target="_blank"
                            className="text-brand-cta font-medium hover:underline"
                          >
                            View photo
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </ReportsTable>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Route reports</CardTitle>
                  <CardDescription>
                    Grouped by individual feature for the selected time period.
                    Most reported features appear first.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {routeReports.length === 0 ? (
                    <p className="text-muted-foreground py-10 text-center text-sm">
                      No route reports in this time period.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {groupedRouteReports.map((group) => (
                        <section
                          key={group.key}
                          className="border-border overflow-hidden rounded-xl border"
                        >
                          <div className="bg-brand px-4 py-3 text-sm font-semibold text-brand-foreground">
                            {group.label} ({group.reports.length}{" "}
                            {group.reports.length === 1 ? "report" : "reports"})
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[640px] text-left text-sm">
                              <thead>
                                <tr>
                                  <Th className="bg-panel text-panel-foreground">
                                    ID
                                  </Th>
                                  <Th className="bg-panel text-panel-foreground">
                                    Date
                                  </Th>
                                  <Th className="bg-panel text-panel-foreground">
                                    Location
                                  </Th>
                                  <Th className="bg-panel text-panel-foreground">
                                    Destination
                                  </Th>
                                  <Th className="bg-panel text-panel-foreground">
                                    Description
                                  </Th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.reports.map((report) => {
                                  const isSelected =
                                    report.id === selectedRouteReportId;
                                  return (
                                    <tr
                                      key={report.id}
                                      onClick={() =>
                                        setSelectedRouteReportId(report.id)
                                      }
                                      className={cn(
                                        "cursor-pointer transition",
                                        isSelected
                                          ? "bg-brand-cta/10"
                                          : "hover:bg-panel-muted/40",
                                      )}
                                    >
                                      <Td className="whitespace-nowrap font-mono text-xs">
                                        #{report.id}
                                      </Td>
                                      <Td className="whitespace-nowrap text-xs">
                                        {formatDate(report.createdAt)}
                                      </Td>
                                      <Td className="text-xs">
                                        {labelFor(
                                          LOCATION_TYPE_ITEMS,
                                          report.locationType,
                                        )}
                                      </Td>
                                      <Td className="text-xs">
                                        {report.destinationName ?? "—"}
                                      </Td>
                                      <Td>{previewText(report.text, 80)}</Td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Dead features</CardTitle>
                  <CardDescription>
                    Outdoor and indoor nodes marked unusable for routing.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DeadFeaturesPanel refreshKey={deadListRefreshKey} />
                </CardContent>
              </Card>
            </div>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Map preview</CardTitle>
                <CardDescription>
                  Outdoor map or indoor floor plan for the selected report.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedRouteReport ? (
                  <p className="text-muted-foreground py-10 text-center text-sm">
                    Select a route report to preview its location.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                          Report
                        </dt>
                        <dd className="mt-1 font-mono text-sm">
                          #{selectedRouteReport.id}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                          User
                        </dt>
                        <dd className="mt-1 text-sm">
                          {selectedRouteReport.userEmail ?? "Guest"}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                          Feature
                        </dt>
                        <dd className="mt-1 text-sm">
                          {routeReportFeatureGroupLabel(selectedRouteReport)}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                          Description
                        </dt>
                        <dd className="mt-1 text-sm">
                          {selectedRouteReport.text?.trim() || "—"}
                        </dd>
                      </div>
                    </dl>

                    {selectedDeadTarget ? (
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={markingDead}
                        onClick={() => void handleMarkSelectedDead()}
                      >
                        {markingDead
                          ? "Marking..."
                          : "Add feature to dead list"}
                      </Button>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        This report has no linked map node to mark dead.
                      </p>
                    )}

                    {isIndoorRouteReport(selectedRouteReport.featureType) &&
                    selectedRouteReport.destinationId != null &&
                    selectedRouteReport.nodeInsideId != null ? (
                      <RouteReportFloorplanPreview
                        destinationId={selectedRouteReport.destinationId}
                        highlightNodeId={selectedRouteReport.nodeInsideId}
                      />
                    ) : (
                      <RouteReportOutdoorPreview
                        destinationPolygon={
                          selectedRouteReport.destinationPolygon
                        }
                        nodeOutsideLat={selectedRouteReport.nodeOutsideLat}
                        nodeOutsideLng={selectedRouteReport.nodeOutsideLng}
                        pinLat={selectedRouteReport.pinLat}
                        pinLng={selectedRouteReport.pinLng}
                        destinationLat={selectedRouteReport.destinationLat}
                        destinationLng={selectedRouteReport.destinationLng}
                        featureType={selectedRouteReport.featureType}
                      />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
