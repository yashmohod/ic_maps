import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { parsePositiveInt } from "@/lib/utils";
import { privateMediaApiPath, savePrivateImage } from "@/lib/private-media";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const destinationIdRaw = formData.get("destinationId");

    console.log(`[API /api/destination/floorplan POST] called`, {
      hasFile: !!file,
      destinationId: destinationIdRaw,
    });

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

    const buffer = Buffer.from(await file.arrayBuffer());
    const { key } = await savePrivateImage({
      kind: "floorplans",
      buffer,
      subdir: destinationId ? `destination-${destinationId}` : undefined,
      baseName: file.name,
    });

    return NextResponse.json(
      {
        url: privateMediaApiPath(key),
        key,
        fileName: key.split("/").pop(),
        destinationId,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    console.error("[API /api/destination/floorplan POST] error", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Upload failed",
        ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}
