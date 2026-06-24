import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  destination,
  nodeInside,
  nodeOutside,
  routeReport,
  user,
} from "@/db/schema";
import { getSession, requireAdmin } from "@/lib/auth-guards";
import { routeReportPayloadSchema } from "@/lib/route-report";
import {
  parseReportDateQuery,
  reportCreatedAtConditions,
} from "@/lib/report-date-query";
import { jsonError } from "@/lib/utils";

export const runtime = "nodejs";

async function verifyDestination(
  destinationId: number,
  locationType: "building" | "parking_lot",
) {
  const [row] = await db
    .select({
      id: destination.id,
      isParkingLot: destination.is_parking_lot,
    })
    .from(destination)
    .where(eq(destination.id, destinationId))
    .limit(1);

  if (!row) return { ok: false as const, error: "Destination not found" };
  if (locationType === "building" && row.isParkingLot) {
    return { ok: false as const, error: "Destination is not a building" };
  }
  if (locationType === "parking_lot" && !row.isParkingLot) {
    return { ok: false as const, error: "Destination is not a parking lot" };
  }
  return { ok: true as const };
}

async function verifyOutsideNode(destinationId: number, nodeOutsideId: number) {
  const result = await db.execute(sql`
    SELECT 1
    FROM destination_node
    WHERE destination_id = ${destinationId}
      AND node_outside_id = ${nodeOutsideId}
    LIMIT 1
  `);
  return result.rows.length > 0;
}

async function verifyInsideNode(
  destinationId: number,
  nodeInsideId: number,
  featureType: "elevator" | "ramp" | "stairs",
) {
  const result = await db.execute(
    featureType === "elevator"
      ? sql`
          SELECT 1 FROM node_inside
          WHERE id = ${nodeInsideId}
            AND destination_id = ${destinationId}
            AND is_elevator = true
          LIMIT 1
        `
      : featureType === "stairs"
        ? sql`
            SELECT 1 FROM node_inside
            WHERE id = ${nodeInsideId}
              AND destination_id = ${destinationId}
              AND is_stairs = true
            LIMIT 1
          `
        : sql`
            SELECT 1 FROM node_inside
            WHERE id = ${nodeInsideId}
              AND destination_id = ${destinationId}
              AND is_ramp = true
            LIMIT 1
          `,
  );
  return result.rows.length > 0;
}

export async function GET(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const parsedDates = parseReportDateQuery(new URL(req.url).searchParams);
  if (!parsedDates.ok) {
    return jsonError(parsedDates.error, 400);
  }

  try {
    const dateFilter = reportCreatedAtConditions(
      routeReport.created_at,
      parsedDates.from,
      parsedDates.to,
    );

    const reports = await db
      .select({
        id: routeReport.id,
        text: routeReport.text,
        locationType: routeReport.location_type,
        destinationId: routeReport.destination_id,
        destinationName: destination.name,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        destinationPolygon: destination.polygon,
        featureType: routeReport.feature_type,
        nodeOutsideId: routeReport.node_outside_id,
        nodeOutsideLat: nodeOutside.lat,
        nodeOutsideLng: nodeOutside.lng,
        nodeInsideId: routeReport.node_inside_id,
        nodeInsideX: nodeInside.x,
        nodeInsideY: nodeInside.y,
        nodeInsideName: nodeInside.name,
        pinLat: routeReport.pin_lat,
        pinLng: routeReport.pin_lng,
        createdAt: routeReport.created_at,
        userId: routeReport.user_id,
        userEmail: user.email,
      })
      .from(routeReport)
      .leftJoin(destination, eq(routeReport.destination_id, destination.id))
      .leftJoin(nodeOutside, eq(routeReport.node_outside_id, nodeOutside.id))
      .leftJoin(nodeInside, eq(routeReport.node_inside_id, nodeInside.id))
      .leftJoin(user, eq(routeReport.user_id, user.id))
      .where(dateFilter)
      .orderBy(desc(routeReport.created_at));

    return NextResponse.json({ reports });
  } catch (err: unknown) {
    console.error("[API /api/report/route GET] error", err);
    return jsonError(
      "Failed to fetch route reports",
      500,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const parsed = routeReportPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const session = await getSession();
    const userId = session?.user?.id ?? null;

    if (data.locationType === "other") {
      const [inserted] = await db
        .insert(routeReport)
        .values({
          text: data.text,
          location_type: data.locationType,
          pin_lat: data.pinLat,
          pin_lng: data.pinLng,
          user_id: userId,
        })
        .returning({ id: routeReport.id });

      if (!inserted) return jsonError("Failed to create report", 500);
      return NextResponse.json({ id: inserted.id }, { status: 201 });
    }

    const destCheck = await verifyDestination(
      data.destinationId,
      data.locationType,
    );
    if (!destCheck.ok) return jsonError(destCheck.error, 400);

    if (data.featureType === "entrance") {
      const valid = await verifyOutsideNode(
        data.destinationId,
        data.nodeOutsideId,
      );
      if (!valid) {
        return jsonError("Entrance does not belong to this destination", 400);
      }

      const [inserted] = await db
        .insert(routeReport)
        .values({
          text: data.text?.trim() ? data.text.trim() : null,
          location_type: data.locationType,
          destination_id: data.destinationId,
          feature_type: data.featureType,
          node_outside_id: data.nodeOutsideId,
          user_id: userId,
        })
        .returning({ id: routeReport.id });

      if (!inserted) return jsonError("Failed to create report", 500);
      return NextResponse.json({ id: inserted.id }, { status: 201 });
    }

    if (
      data.featureType === "elevator" ||
      data.featureType === "ramp" ||
      data.featureType === "stairs"
    ) {
      const valid = await verifyInsideNode(
        data.destinationId,
        data.nodeInsideId,
        data.featureType,
      );
      if (!valid) {
        return jsonError(
          "Indoor feature does not belong to this destination",
          400,
        );
      }

      const [inserted] = await db
        .insert(routeReport)
        .values({
          text: data.text?.trim() ? data.text.trim() : null,
          location_type: data.locationType,
          destination_id: data.destinationId,
          feature_type: data.featureType,
          node_inside_id: data.nodeInsideId,
          user_id: userId,
        })
        .returning({ id: routeReport.id });

      if (!inserted) return jsonError("Failed to create report", 500);
      return NextResponse.json({ id: inserted.id }, { status: 201 });
    }

    if (data.featureType === "other") {
      const [inserted] = await db
        .insert(routeReport)
        .values({
          text: data.text,
          location_type: data.locationType,
          destination_id: data.destinationId,
          feature_type: data.featureType,
          pin_lat: data.pinLat,
          pin_lng: data.pinLng,
          user_id: userId,
        })
        .returning({ id: routeReport.id });

      if (!inserted) return jsonError("Failed to create report", 500);
      return NextResponse.json({ id: inserted.id }, { status: 201 });
    }

    return jsonError("Unsupported report type", 400);
  } catch (err: unknown) {
    console.error("[API /api/report/route POST] error", err);
    return jsonError(
      "Failed to submit route report",
      500,
      err instanceof Error ? err.message : String(err),
    );
  }
}
