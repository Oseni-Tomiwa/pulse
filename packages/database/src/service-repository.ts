import { randomUUID } from "node:crypto";
import type { Service } from "@pulse/contracts";
import { desc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { services } from "./schema.js";

export function createServiceRepository(db: Database) {
  return {
    async createService(projectId: string, name: string): Promise<Service> {
      const [created] = await db
        .insert(services)
        .values({
          id: randomUUID(),
          projectId,
          name,
          createdAt: new Date(),
        })
        .returning();

      return created;
    },

    async listServicesByProjectId(projectId: string): Promise<Service[]> {
      return db
        .select()
        .from(services)
        .where(eq(services.projectId, projectId))
        .orderBy(desc(services.createdAt), desc(services.id));
    },

    async getServiceById(id: string): Promise<Service | null> {
      const [service] = await db
        .select()
        .from(services)
        .where(eq(services.id, id))
        .limit(1);

      return service ?? null;
    },
  };
}
