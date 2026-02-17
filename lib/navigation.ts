import { sql } from "drizzle-orm";
import { db } from "@/db/index";

export async function closestNode(lat:number,lng:number){
    const result  = await db.execute(sql<{id:number}>`SELECT id FROM node ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), id LIMIT 1;`);
   return result.rows[0]?.id ?? -1; 
}

export function calcDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const R =  6371000; // Earth radius (m)
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function navigateTo() {
}