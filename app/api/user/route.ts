import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/local-users";
import { getUser } from "@/db/index";

const BACKEND = "http://localhost:8080";
const ROUTE = "/api/user";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = (searchParams.get("id") || "").trim();

  if (id) {
    return NextResponse.json({ user: getLocalUser(id) });
  }

  const qs = new URL(req.url).search;
  console.log(`[API ${ROUTE} GET] called`, { search: qs });
  try {
  const curUser = await getUser(qs);
  let res = JSON.stringify(curUser);
  // safest passthrough (doesn't explode on non-json errors)
  return new NextResponse(res, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  } catch (error) {
    console.error(`[API ${ROUTE} GET] error`, error);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}
