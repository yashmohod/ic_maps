"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import ComboboxSelect from "@/components/DropDown";
import { RouteReportMap } from "@/components/route-report-map";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import apiClient from "@/lib/apiClient";
import {
  buildRouteReportPayload,
  entranceLabel,
  FEATURE_TYPE_ITEMS,
  featureTypeEmptyMessage,
  filterInsideNodes,
  insideNodeLabel,
  LOCATION_TYPE_ITEMS,
  mapMode,
  parsePolygon,
  requiresDescription,
  requiresPin,
  showsMap,
  type RouteReportEntranceNode,
  type RouteReportFeatureType,
  type RouteReportInsideNode,
  type RouteReportLocationType,
} from "@/lib/route-report";
import type { MapDestination } from "@/lib/types/map";
import { cn } from "@/lib/utils";

type RouteReportFormProps = {
  className?: string;
  onSuccess: (reportId: number) => void;
};

export function RouteReportForm({
  className,
  onSuccess,
}: RouteReportFormProps) {
  const [loading, setLoading] = useState(false);
  const [destinationsLoading, setDestinationsLoading] = useState(true);
  const [destinations, setDestinations] = useState<MapDestination[]>([]);

  const [locationType, setLocationType] =
    useState<RouteReportLocationType | null>(null);
  const [destinationId, setDestinationId] = useState<number | null>(null);
  const [featureType, setFeatureType] = useState<RouteReportFeatureType | null>(
    null,
  );
  const [selectedOutsideNodeId, setSelectedOutsideNodeId] = useState<
    number | null
  >(null);
  const [selectedInsideNodeId, setSelectedInsideNodeId] = useState<
    number | null
  >(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [text, setText] = useState("");

  const [entrances, setEntrances] = useState<RouteReportEntranceNode[]>([]);
  const [insideNodes, setInsideNodes] = useState<RouteReportInsideNode[]>([]);
  const [featureDataLoading, setFeatureDataLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDestinationsLoading(true);

    (async () => {
      try {
        const resp = await apiClient.get("/api/destination");
        const payload = await resp.json();
        if (cancelled) return;

        const list = Array.isArray(payload?.destinations)
          ? (payload.destinations as MapDestination[])
          : [];
        setDestinations(list);
      } catch {
        if (!cancelled) toast.error("Failed to load locations");
      } finally {
        if (!cancelled) setDestinationsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const buildings = useMemo(
    () => destinations.filter((d) => !d.isParkingLot),
    [destinations],
  );
  const parkingLots = useMemo(
    () => destinations.filter((d) => d.isParkingLot),
    [destinations],
  );

  const destinationOptions = useMemo(() => {
    const list =
      locationType === "building"
        ? buildings
        : locationType === "parking_lot"
          ? parkingLots
          : [];
    return list.map((d) => ({ value: d.id, label: d.name }));
  }, [locationType, buildings, parkingLots]);

  const selectedDestination = useMemo(
    () => destinations.find((d) => d.id === destinationId) ?? null,
    [destinations, destinationId],
  );

  const polygon = useMemo(
    () => parsePolygon(selectedDestination?.polygon),
    [selectedDestination],
  );

  useEffect(() => {
    if (!destinationId || !featureType) {
      setEntrances([]);
      setInsideNodes([]);
      return;
    }

    let cancelled = false;
    setFeatureDataLoading(true);

    (async () => {
      try {
        if (featureType === "entrance") {
          const resp = await apiClient.get(
            `/api/destination/outsideNode?id=${encodeURIComponent(destinationId)}`,
          );
          const payload = await resp.json();
          if (cancelled) return;

          const details = Array.isArray(payload?.nodeDetails)
            ? (payload.nodeDetails as RouteReportEntranceNode[])
            : [];
          setEntrances(details);
          setInsideNodes([]);
          return;
        }

        if (
          featureType === "elevator" ||
          featureType === "ramp" ||
          featureType === "stairs"
        ) {
          const resp = await apiClient.get(
            `/api/destination/floorplan/nodes?destinationId=${encodeURIComponent(destinationId)}`,
          );
          const payload = await resp.json();
          if (cancelled) return;

          const nodes = Array.isArray(payload?.nodes)
            ? (payload.nodes as RouteReportInsideNode[])
            : [];
          setInsideNodes(nodes);
          setEntrances([]);
          return;
        }

        setEntrances([]);
        setInsideNodes([]);
      } catch {
        if (!cancelled) toast.error("Failed to load location features");
      } finally {
        if (!cancelled) setFeatureDataLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [destinationId, featureType]);

  const filteredInsideNodes = useMemo(() => {
    if (
      featureType !== "elevator" &&
      featureType !== "ramp" &&
      featureType !== "stairs"
    ) {
      return [];
    }
    return filterInsideNodes(insideNodes, featureType);
  }, [insideNodes, featureType]);

  const entranceItems = useMemo(
    () =>
      entrances.map((node, index) => ({
        value: node.id,
        label: entranceLabel(node, index),
      })),
    [entrances],
  );

  const insideNodeItems = useMemo(() => {
    if (
      featureType !== "elevator" &&
      featureType !== "ramp" &&
      featureType !== "stairs"
    ) {
      return [];
    }
    return filteredInsideNodes.map((node, index) => ({
      value: node.id,
      label: insideNodeLabel(node, insideNodes, featureType, index),
    }));
  }, [filteredInsideNodes, insideNodes, featureType]);

  const descriptionRequired = requiresDescription(locationType, featureType);
  const pinRequired = requiresPin(locationType, featureType);
  const mapVisible = showsMap(locationType, featureType);
  const currentMapMode = mapMode(locationType, featureType);

  const emptyFeatureMessage =
    featureType && featureType !== "other"
      ? featureTypeEmptyMessage(featureType)
      : "";

  const hasEmptyFeatureList =
    (featureType === "entrance" &&
      !featureDataLoading &&
      entrances.length === 0) ||
    ((featureType === "elevator" ||
      featureType === "ramp" ||
      featureType === "stairs") &&
      !featureDataLoading &&
      filteredInsideNodes.length === 0);

  function resetDependentState(next: {
    locationType?: RouteReportLocationType | null;
    destinationId?: number | null;
    featureType?: RouteReportFeatureType | null;
  }) {
    if ("locationType" in next) {
      setDestinationId(null);
      setFeatureType(null);
    }
    if ("destinationId" in next) {
      setFeatureType(null);
    }
    setSelectedOutsideNodeId(null);
    setSelectedInsideNodeId(null);
    setPin(null);
    setEntrances([]);
    setInsideNodes([]);
  }

  function handleLocationTypeChange(value: RouteReportLocationType) {
    setLocationType(value);
    resetDependentState({ locationType: value });
  }

  function handleDestinationChange(value: number) {
    setDestinationId(value);
    resetDependentState({ destinationId: value });
  }

  function handleFeatureTypeChange(value: RouteReportFeatureType) {
    setFeatureType(value);
    setSelectedOutsideNodeId(null);
    setSelectedInsideNodeId(null);
    setPin(null);
  }

  const canSubmit = useMemo(() => {
    if (!locationType) return false;
    if (descriptionRequired && text.trim().length < 10) return false;
    if (pinRequired && !pin) return false;

    if (locationType === "building" || locationType === "parking_lot") {
      if (!destinationId || !featureType) return false;
      if (hasEmptyFeatureList) return false;
      if (featureType === "entrance" && !selectedOutsideNodeId) return false;
      if (
        (featureType === "elevator" ||
          featureType === "ramp" ||
          featureType === "stairs") &&
        !selectedInsideNodeId
      ) {
        return false;
      }
    }

    return (
      buildRouteReportPayload({
        locationType,
        destinationId,
        featureType,
        selectedOutsideNodeId,
        selectedInsideNodeId,
        pin,
        text,
      }) != null
    );
  }, [
    locationType,
    destinationId,
    featureType,
    selectedOutsideNodeId,
    selectedInsideNodeId,
    pin,
    text,
    descriptionRequired,
    pinRequired,
    hasEmptyFeatureList,
  ]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!locationType) {
      toast.error("Select a location type");
      return;
    }

    const payload = buildRouteReportPayload({
      locationType,
      destinationId,
      featureType,
      selectedOutsideNodeId,
      selectedInsideNodeId,
      pin,
      text,
    });

    if (!payload) {
      toast.error("Please complete all required fields");
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch("/api/report/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await resp.json().catch(() => null)) as {
        error?: string;
        id?: number;
      } | null;

      if (!resp.ok) {
        toast.error(data?.error ?? "Failed to submit route report");
        return;
      }

      if (typeof data?.id !== "number") {
        toast.error("Unexpected response from server");
        return;
      }

      onSuccess(data.id);
    } catch {
      toast.error("Failed to submit route report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <Card>
        <CardHeader className="text-center">
          <h2 className="text-xl leading-none font-semibold">Route report</h2>
          <CardDescription>
            Report a map or routing problem at a building, parking lot, or
            anywhere on campus.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">Location type</label>
              <ComboboxSelect
                placeholder="Select location type"
                value={locationType}
                items={LOCATION_TYPE_ITEMS}
                onChange={handleLocationTypeChange}
                widthClassName="w-full"
                disabled={destinationsLoading}
              />
            </div>

            {(locationType === "building" ||
              locationType === "parking_lot") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {locationType === "building" ? "Building" : "Parking lot"}
                </label>
                <ComboboxSelect
                  placeholder={
                    locationType === "building"
                      ? "Select a building"
                      : "Select a parking lot"
                  }
                  value={destinationId}
                  items={destinationOptions}
                  onChange={handleDestinationChange}
                  widthClassName="w-full"
                  disabled={
                    destinationsLoading || destinationOptions.length === 0
                  }
                  searchPlaceholder="Search..."
                />
              </div>
            )}

            {destinationId != null && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Feature type</label>
                <ComboboxSelect
                  placeholder="Select feature type"
                  value={featureType}
                  items={FEATURE_TYPE_ITEMS}
                  onChange={handleFeatureTypeChange}
                  widthClassName="w-full"
                />
              </div>
            )}

            {featureType === "entrance" && destinationId != null && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Entrance</label>
                {featureDataLoading ? (
                  <p className="text-muted-foreground text-sm">
                    Loading entrances...
                  </p>
                ) : hasEmptyFeatureList ? (
                  <p className="text-muted-foreground text-sm">
                    {emptyFeatureMessage}
                  </p>
                ) : (
                  <ComboboxSelect
                    placeholder="Select an entrance"
                    value={selectedOutsideNodeId}
                    items={entranceItems}
                    onChange={setSelectedOutsideNodeId}
                    widthClassName="w-full"
                    searchPlaceholder="Search entrances..."
                  />
                )}
              </div>
            )}

            {(featureType === "elevator" ||
              featureType === "ramp" ||
              featureType === "stairs") &&
              destinationId != null && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {FEATURE_TYPE_ITEMS.find(
                      (item) => item.value === featureType,
                    )?.label ?? "Feature"}
                  </label>
                  {featureDataLoading ? (
                    <p className="text-muted-foreground text-sm">
                      Loading features...
                    </p>
                  ) : hasEmptyFeatureList ? (
                    <p className="text-muted-foreground text-sm">
                      {emptyFeatureMessage}
                    </p>
                  ) : (
                    <ComboboxSelect
                      placeholder={`Select ${featureType}`}
                      value={selectedInsideNodeId}
                      items={insideNodeItems}
                      onChange={setSelectedInsideNodeId}
                      widthClassName="w-full"
                      searchPlaceholder="Search..."
                    />
                  )}
                </div>
              )}

            {mapVisible && (
              <RouteReportMap
                mode={currentMapMode}
                polygon={locationType === "other" ? null : polygon}
                entrances={currentMapMode === "entrance" ? entrances : []}
                selectedOutsideNodeId={selectedOutsideNodeId}
                pin={pin}
                onSelectEntrance={setSelectedOutsideNodeId}
                onPinChange={setPin}
              />
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Description{" "}
                <span className="text-muted-foreground text-xs">
                  {descriptionRequired ? "(required)" : "(optional)"}
                </span>
              </label>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={5}
                placeholder={
                  descriptionRequired
                    ? "Describe the routing or map problem..."
                    : "Add any extra details that would help us fix this..."
                }
                aria-required={descriptionRequired}
                className={cn(
                  "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[120px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                )}
              />
              {descriptionRequired &&
                text.trim().length > 0 &&
                text.trim().length < 10 && (
                  <p className="text-destructive text-sm">
                    Description must be at least 10 characters.
                  </p>
                )}
            </div>

            <Button
              type="submit"
              disabled={loading || !canSubmit}
              aria-busy={loading}
              className="bg-brand-cta text-brand-cta-foreground w-full font-semibold tracking-wide uppercase hover:bg-brand-cta/90"
            >
              {loading ? (
                <>
                  <Spinner />
                  <span className="sr-only">Submitting</span>
                </>
              ) : null}
              Submit report
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
