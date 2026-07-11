import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { accessibilityReport, user } from "@/db/schema";
import { getSession, requireAdmin } from "@/lib/auth-guards";
import {
  parseReportDateQuery,
  reportCreatedAtConditions,
} from "@/lib/report-date-query";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const accessibilityReportTextSchema = z
  .string()
  .trim()
  .min(10, "Description must be at least 10 characters")
  .max(5000, "Description must be at most 5000 characters");

function extensionFromMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".bin";
  }
}

function resolveExtension(file: File): string {
  const extFromName = path.extname(file.name).toLowerCase();
  if (
    extFromName === ".png" ||
    extFromName === ".jpg" ||
    extFromName === ".jpeg" ||
    extFromName === ".webp" ||
    extFromName === ".gif"
  ) {
    return extFromName === ".jpeg" ? ".jpg" : extFromName;
  }
  return extensionFromMime(file.type);
}

export async function GET(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const parsedDates = parseReportDateQuery(new URL(req.url).searchParams);
  if (!parsedDates.ok) {
    return NextResponse.json({ error: parsedDates.error }, { status: 400 });
  }

  try {
    const dateFilter = reportCreatedAtConditions(
      accessibilityReport.created_at,
      parsedDates.from,
      parsedDates.to,
    );

    const reports = await db
      .select({
        id: accessibilityReport.id,
        text: accessibilityReport.text,
        photoPath: accessibilityReport.photo_path,
        createdAt: accessibilityReport.created_at,
        userId: accessibilityReport.user_id,
        userEmail: user.email,
      })
      .from(accessibilityReport)
      .leftJoin(user, eq(accessibilityReport.user_id, user.id))
      .where(dateFilter)
      .orderBy(desc(accessibilityReport.created_at));

    return NextResponse.json({ reports });
  } catch (err: unknown) {
    console.error("[API /api/report/accessibility GET] error", err);
    return NextResponse.json({ error: "Failed to fetch accessibility reports", ...(process.env.NODE_ENV !== "production" ? { detail: String(err instanceof Error ? err.message : String(err)) } : {}) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const textRaw = formData.get("text");
    const photo = formData.get("photo");

    if (typeof textRaw !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    const parsedText = accessibilityReportTextSchema.safeParse(textRaw);
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
      return NextResponse.json({ error: "Invalid photo field" }, { status: 400 });
    }

    const file = photo instanceof File && photo.size > 0 ? photo : null;

    if (file) {
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return NextResponse.json({ error: "Unsupported file type. Use png/jpg/webp/gif." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "File too large. Max size is 10MB." }, { status: 413 });
      }
    }

    const session = await getSession();
    const userId = session?.user?.id ?? null;

    const [inserted] = await db
      .insert(accessibilityReport)
      .values({
        text: parsedText.data,
        photo_path: null,
        user_id: userId,
      })
      .returning({ id: accessibilityReport.id });

    if (!inserted) {
      return NextResponse.json({ error: "Failed to create report" }, { status: 500 });
    }

    let photoPath: string | null = null;

    if (file) {
      const ext = resolveExtension(file);
      const fileName = `a11y_${inserted.id}_1${ext}`;
      const relativePath = `/report/${fileName}`;
      const uploadsDir = path.join(process.cwd(), "public", "report");
      const savePath = path.join(uploadsDir, fileName);

      try {
        await mkdir(uploadsDir, { recursive: true });
        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(savePath, buffer);

        await db
          .update(accessibilityReport)
          .set({ photo_path: relativePath })
          .where(eq(accessibilityReport.id, inserted.id));

        photoPath = relativePath;
      } catch (err: unknown) {
        await db
          .delete(accessibilityReport)
          .where(eq(accessibilityReport.id, inserted.id));
        console.error(
          "[API /api/report/accessibility POST] photo save error",
          err,
        );
        return NextResponse.json({ error: "Failed to save photo", ...(process.env.NODE_ENV !== "production" ? { detail: String(err instanceof Error ? err.message : String(err)) } : {}) }, { status: 500 });
      }
    }

    return NextResponse.json({ id: inserted.id, photoPath }, { status: 201 });
  } catch (err: unknown) {
    console.error("[API /api/report/accessibility POST] error", err);
    return NextResponse.json({ error: "Failed to submit accessibility report", ...(process.env.NODE_ENV !== "production" ? { detail: String(err instanceof Error ? err.message : String(err)) } : {}) }, { status: 500 });
  }
}
