import { sql } from "drizzle-orm";
import { db } from "@/db/index";

export async function closestNode(lat:number,lng:number){
    const result  = await db.execute(sql<{id:number}>`SELECT id FROM node ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), id LIMIT 1;`);
   return result.rows[0]?.id ?? -1; 
}

export function navigateTo() {
}