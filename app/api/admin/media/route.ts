import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { readPrivateOrLegacyMedia } from "@/lib/private-media";

export const runtime = "nodejs";

/** GET /api/admin/media?key=floorplans/…|reports/… — admin-only private upload stream. */
export async function GET(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const key = new URL(req.url).searchParams.get("key")?.trim() ?? "";
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const file = await readPrivateOrLegacyMedia(key);
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
