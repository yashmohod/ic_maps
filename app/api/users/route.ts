import { NextResponse } from "next/server";
import { listLocalUsers } from "@/lib/local-users";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim();
  return NextResponse.json({ users: listLocalUsers(search) });
}
