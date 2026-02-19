import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

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

function sanitizeBaseFileName(fileName: string): string {
  const rawBase = path.basename(fileName, path.extname(fileName));
  const safe = rawBase.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe.length > 0 ? safe.slice(0, 50) : "floorplan";
}

function parsePositiveInt(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const destinationIdRaw = formData.get("destinationId");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const destinationId =
      destinationIdRaw == null ? null : parsePositiveInt(destinationIdRaw);
    if (destinationIdRaw != null && destinationId == null) {
      return NextResponse.json(
        { error: "Invalid destinationId" },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Use png/jpg/webp/gif." },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Max size is 10MB." },
        { status: 413 },
      );
    }

    const uploadsDir = path.join(
      process.cwd(),
      "public",
      "uploads",
      "floorplans",
      destinationId ? `destination-${destinationId}` : "",
    );
    await mkdir(uploadsDir, { recursive: true });

    const extFromName = path.extname(file.name).toLowerCase();
    const ext =
      extFromName === ".png" ||
      extFromName === ".jpg" ||
      extFromName === ".jpeg" ||
      extFromName === ".webp" ||
      extFromName === ".gif"
        ? extFromName
        : extensionFromMime(file.type);
    const base = sanitizeBaseFileName(file.name);
    const fileName = `${Date.now()}-${base}-${randomUUID().slice(0, 8)}${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const savePath = path.join(uploadsDir, fileName);
    await writeFile(savePath, buffer);

    const relativeDir = destinationId
      ? `/uploads/floorplans/destination-${destinationId}`
      : "/uploads/floorplans";

    return NextResponse.json(
      {
        url: `${relativeDir}/${fileName}`,
        fileName,
        destinationId,
      },
      { status: 201 },
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Upload failed",
        detail: err?.message ?? String(err),
      },
      { status: 500 },
    );
  }
}
