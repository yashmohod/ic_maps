import { auth } from "@/lib/auth"; // path to your auth file
import { toNextJsHandler } from "better-auth/next-js";

const ROUTE = "/api/auth/[...all]";
const handler = toNextJsHandler(auth);

export async function POST(req: Request, ...args: unknown[]) {
  const url = new URL(req.url);
  console.log(`[API ${ROUTE} POST] called`, { pathname: url.pathname });
  try {
    return await (handler.POST as (r: Request, ...a: unknown[]) => ReturnType<typeof handler.POST>)(req, ...args);
  } catch (err) {
    console.error(`[API ${ROUTE} POST] error`, err);
    throw err;
  }
}

export async function GET(req: Request, ...args: unknown[]) {
  const url = new URL(req.url);
  console.log(`[API ${ROUTE} GET] called`, { pathname: url.pathname });
  try {
    return await (handler.GET as (r: Request, ...a: unknown[]) => ReturnType<typeof handler.GET>)(req, ...args);
  } catch (err) {
    console.error(`[API ${ROUTE} GET] error`, err);
    throw err;
  }
}
