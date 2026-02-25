import { NextResponse } from "next/server";

function disabled() {
  return NextResponse.json(
    { error: "Better Auth endpoint disabled for Java-backend mode." },
    { status: 410 },
  );
}

export async function GET() {
  return disabled();
}

export async function POST() {
  return disabled();
}
