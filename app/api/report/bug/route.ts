import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { bugReport } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-guards";
import {
  parseReportDateQuery,
  reportCreatedAtConditions,
} from "@/lib/report-date-query";
import { savePrivateImage } from "@/lib/private-media";
import {
  REPORT_RATE_LIMIT,
  clientIpFromRequest,
  takeRateLimit,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const bugReportTextSchema = z
  .string()
  .trim()
  .min(10, "Description must be at least 10 characters")
  .max(5000, "Description must be at most 5000 characters");

export async function GET(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const parsedDates = parseReportDateQuery(new URL(req.url).searchParams);
  if (!parsedDates.ok) {
    return NextResponse.json({ error: parsedDates.error }, { status: 400 });
  }

  try {
    const dateFilter = reportCreatedAtConditions(
      bugReport.created_at,
      parsedDates.from,
      parsedDates.to,
    );

    const reports = await db
      .select({
        id: bugReport.id,
        text: bugReport.text,
        photoPath: bugReport.photo_path,
        createdAt: bugReport.created_at,
      })
      .from(bugReport)
      .where(dateFilter)
      .orderBy(desc(bugReport.created_at));

    return NextResponse.json({ reports });
  } catch (err: unknown) {
    console.error("[API /api/report/bug GET] error", err);
    return NextResponse.json(
      {
        error: "Failed to fetch bug reports",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: String(err instanceof Error ? err.message : String(err)) }
          : {}),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const limit = takeRateLimit(
    `report:bug:${clientIpFromRequest(req)}`,
    REPORT_RATE_LIMIT,
  );
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: "Too many reports. Try again shortly.",
        retryAfterMs: limit.retryAfterMs,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
        },
      },
    );
  }

  try {
    const formData = await req.formData();
    const textRaw = formData.get("text");
    const photo = formData.get("photo");

    if (typeof textRaw !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    const parsedText = bugReportTextSchema.safeParse(textRaw);
    if (!parsedText.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsedText.error.flatten(),
        },
        { status: 400 },
      );
    }

    if (photo != null && !(photo instanceof File)) {
      return NextResponse.json(
        { error: "Invalid photo field" },
        { status: 400 },
      );
    }

    const file = photo instanceof File && photo.size > 0 ? photo : null;

    if (file) {
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return NextResponse.json(
          { error: "Unsupported file type. Use png/jpg/webp/gif." },
          { status: 400 },
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "File too large. Max size is 10MB." },
          { status: 413 },
        );
      }
    }

    const [inserted] = await db
      .insert(bugReport)
      .values({ text: parsedText.data, photo_path: null })
      .returning({ id: bugReport.id });

    if (!inserted) {
      return NextResponse.json(
        { error: "Failed to create report" },
        { status: 500 },
      );
    }

    let photoPath: string | null = null;

    if (file) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const { key } = await savePrivateImage({
          kind: "reports",
          buffer,
          baseName: `bug-${inserted.id}`,
        });
        await db
          .update(bugReport)
          .set({ photo_path: key })
          .where(eq(bugReport.id, inserted.id));
        photoPath = key;
      } catch (err: unknown) {
        await db.delete(bugReport).where(eq(bugReport.id, inserted.id));
        console.error("[API /api/report/bug POST] photo save error", err);
        return NextResponse.json(
          {
            error: "Failed to save photo",
            ...(process.env.NODE_ENV !== "production"
              ? {
                  detail: String(
                    err instanceof Error ? err.message : String(err),
                  ),
                }
              : {}),
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ id: inserted.id, photoPath }, { status: 201 });
  } catch (err: unknown) {
    console.error("[API /api/report/bug POST] error", err);
    return NextResponse.json(
      {
        error: "Failed to submit bug report",
        ...(process.env.NODE_ENV !== "production"
          ? { detail: String(err instanceof Error ? err.message : String(err)) }
          : {}),
      },
      { status: 500 },
    );
  } finally {
    limit.release();
  }
}
