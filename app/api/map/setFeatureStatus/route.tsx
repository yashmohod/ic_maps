import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";


export async function POST(req: Request) {
  try {
    const {id, value, featureType, navMode } = await req.json();

    let nm = navMode.toLowerCase();  

    const result = await db.execute(sql`
      UPDATE  ${featureType}_outside 
      SET is_${nm}=${value}
      WHERE id=${id};
    `);
    
    return NextResponse.json({}, { status: 201 });
  } catch (err: any) {
    // Common ones:
    // - unique violation on name
    // - null/constraint violations
    // - bad SQL
    return NextResponse.json(
      { error: "Insert failed", detail: err?.message ?? String(err) },
      { status: 400 },
    );
  }
}
