import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export * from "./schema.js";

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });

  return { db, pool };
}
