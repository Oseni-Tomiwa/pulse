import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create a database client");
  }

  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });

  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];
