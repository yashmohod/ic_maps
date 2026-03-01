import { getUser } from "@/db";
import { NextResponse } from "next/server";

const BACKEND = "http://localhost:8080";
const ROUTE = "/api/user";

export async function GET(req: Request) {
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
