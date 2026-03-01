import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*"], // Specify the routes the middleware applies to
};
