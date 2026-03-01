import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isFiniteNumber, jsonError, parseId } from "@/lib/utils";

const ROUTE = "/api/destination/floorplan/nodes";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const destinationId = searchParams.get("destinationId");
    console.log(`[API ${ROUTE} GET] called`, { destinationId });
    const did = parseId(destinationId);
    if (!did) return jsonError("Invalid destinationId", 400);

    const result = await db.execute(sql`
      SELECT id, node_outside_id AS "nodeOutsideId", parent_node_inside_id AS "parentNodeInsideId",
             x, y,
             is_entry AS "isEntry", is_exit AS "isExit",
             is_elevator AS "isElevator", is_stairs AS "isStairs",
             is_ramp AS "isRamp", is_group AS "isGroup",
             image_url AS "imageUrl", incline, width, height
      FROM node_inside
      WHERE destination_id = ${did}
      ORDER BY is_group DESC NULLS LAST, parent_node_inside_id NULLS FIRST, id
    `);

    const nodes = result.rows.map((row) => ({
      id: row.id,
      nodeOutsideId: row.nodeOutsideId,
      parentNodeInsideId: row.parentNodeInsideId != null ? Number(row.parentNodeInsideId) : null,
      x: Number(row.x),
      y: Number(row.y),
      isEntry: Boolean(row.isEntry),
      isExit: Boolean(row.isExit),
      isElevator: Boolean(row.isElevator),
      isStairs: Boolean(row.isStairs),
      isRamp: Boolean(row.isRamp),
      isGroup: Boolean(row.isGroup),
      imageUrl: row.imageUrl ?? null,
      incline: row.incline != null ? Number(row.incline) : null,
      width: row.width != null ? Number(row.width) : null,
      height: row.height != null ? Number(row.height) : null,
    }));

    return NextResponse.json({ nodes }, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} GET] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Could not fetch nodes", 500, message);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const {
      destinationId,
      x,
      y,
      nodeOutsideId,
      parentNodeInsideId,
      isEntry,
      isExit,
      isElevator,
      isStairs,
      isRamp,
      isGroup,
      imageUrl,
      incline,
      width,
      height,
    } = body as Record<string, unknown>;

    console.log(`[API ${ROUTE} POST] called`, {
      destinationId,
      x,
      y,
      nodeOutsideId,
      parentNodeInsideId,
      isEntry,
      isExit,
      isElevator,
      isStairs,
      isRamp,
      isGroup,
    });

    const did = parseId(destinationId);
    if (!did) return jsonError("Invalid destinationId", 400);
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      return jsonError("Invalid x or y", 400);
    }

    const nid = nodeOutsideId != null ? parseId(nodeOutsideId) : null;
    const parentId = parentNodeInsideId != null ? parseId(parentNodeInsideId) : null;
    const widthVal =
      width != null && isFiniteNumber(width) && (width as number) > 0 ? (width as number) : null;
    const heightVal =
      height != null && isFiniteNumber(height) && (height as number) > 0 ? (height as number) : null;
    const result = await db.execute(sql`
      INSERT INTO node_inside (
        destination_id, node_outside_id, parent_node_inside_id, x, y,
        is_entry, is_exit, is_elevator, is_stairs, is_ramp, is_group,
        image_url, incline, width, height
      )
      VALUES (
        ${did},
        ${nid},
        ${parentId},
        ${x as number},
        ${y as number},
        ${Boolean(isEntry)},
        ${Boolean(isExit)},
        ${Boolean(isElevator)},
        ${Boolean(isStairs)},
        ${Boolean(isRamp)},
        ${Boolean(isGroup)},
        ${imageUrl != null ? String(imageUrl) : null},
        ${incline != null && isFiniteNumber(incline) ? (incline as number) : null},
        ${widthVal},
        ${heightVal}
      )
      RETURNING id, node_outside_id AS "nodeOutsideId", parent_node_inside_id AS "parentNodeInsideId", x, y,
                is_entry AS "isEntry", is_exit AS "isExit",
                is_elevator AS "isElevator", is_stairs AS "isStairs",
                is_ramp AS "isRamp", is_group AS "isGroup",
                image_url AS "imageUrl", incline, width, height
    `);

    const row = result.rows[0];
    if (!row?.id) return jsonError("Insert failed", 500);

    return NextResponse.json(
      {
        id: row.id,
        nodeOutsideId: row.nodeOutsideId,
        parentNodeInsideId: row.parentNodeInsideId != null ? Number(row.parentNodeInsideId) : null,
        x: Number(row.x),
        y: Number(row.y),
        isEntry: Boolean(row.isEntry),
        isExit: Boolean(row.isExit),
        isElevator: Boolean(row.isElevator),
        isStairs: Boolean(row.isStairs),
        isRamp: Boolean(row.isRamp),
        isGroup: Boolean(row.isGroup),
        imageUrl: row.imageUrl ?? null,
        incline: row.incline != null ? Number(row.incline) : null,
        width: row.width != null ? Number(row.width) : null,
        height: row.height != null ? Number(row.height) : null,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} POST] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Insert failed", 500, message);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { id, x, y, parentNodeInsideId, isEntry, isExit, isElevator, isStairs, isRamp, isGroup, imageUrl, incline, width, height } =
      body as Record<string, unknown>;

    console.log(`[API ${ROUTE} PUT] called`, {
      id,
      x,
      y,
      parentNodeInsideId,
      isEntry,
      isExit,
      isElevator,
      isStairs,
      isRamp,
      isGroup,
    });

    const nid = parseId(id);
    if (!nid) return jsonError("Invalid id", 400);

    const setParts: ReturnType<typeof sql>[] = [];

    if (x !== undefined && isFiniteNumber(x)) setParts.push(sql`x = ${x}`);
    if (y !== undefined && isFiniteNumber(y)) setParts.push(sql`y = ${y}`);
    if (parentNodeInsideId !== undefined) {
      const pid = parentNodeInsideId === null ? null : parseId(parentNodeInsideId);
      setParts.push(sql`parent_node_inside_id = ${pid}`);
    }
    if (typeof isEntry === "boolean") setParts.push(sql`is_entry = ${isEntry}`);
    if (typeof isExit === "boolean") setParts.push(sql`is_exit = ${isExit}`);
    if (typeof isElevator === "boolean") setParts.push(sql`is_elevator = ${isElevator}`);
    if (typeof isStairs === "boolean") setParts.push(sql`is_stairs = ${isStairs}`);
    if (typeof isRamp === "boolean") setParts.push(sql`is_ramp = ${isRamp}`);
    if (typeof isGroup === "boolean") setParts.push(sql`is_group = ${isGroup}`);
    if (imageUrl !== undefined) {
      setParts.push(sql`image_url = ${imageUrl === null ? null : String(imageUrl)}`);
    }
    if (incline !== undefined) {
      setParts.push(
        sql`incline = ${incline === null || !isFiniteNumber(incline) ? null : (incline as number)}`
      );
    }
    if (width !== undefined) {
      const widthVal =
        width === null || !isFiniteNumber(width) || (width as number) <= 0
          ? null
          : (width as number);
      setParts.push(sql`width = ${widthVal}`);
    }
    if (height !== undefined) {
      const heightVal =
        height === null || !isFiniteNumber(height) || (height as number) <= 0
          ? null
          : (height as number);
      setParts.push(sql`height = ${heightVal}`);
    }

    if (setParts.length === 0) return NextResponse.json({}, { status: 200 });

    const result = await db.execute(
      sql`UPDATE node_inside SET ${sql.join(setParts, sql`, `)} WHERE id = ${nid} RETURNING id`
    );
    if (result.rows.length === 0) return jsonError("Node not found", 404);

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} PUT] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Update failed", 500, message);
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body", 400);

    const { id } = body as { id: unknown };
    console.log(`[API ${ROUTE} DELETE] called`, { id });
    const nid = parseId(id);
    if (!nid) return jsonError("Invalid id", 400);

    await db.execute(sql`DELETE FROM edge_inside WHERE node_a_id = ${nid} OR node_b_id = ${nid}`);
    const result = await db.execute(sql`DELETE FROM node_inside WHERE id = ${nid} RETURNING id`);

    if (result.rows.length === 0) return jsonError("Node not found", 404);

    return NextResponse.json({}, { status: 200 });
  } catch (err: unknown) {
    console.error(`[API ${ROUTE} DELETE] error`, err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("Delete failed", 500, message);
  }
}
