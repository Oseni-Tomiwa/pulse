import { randomUUID } from "node:crypto";
import type { Project } from "@pulse/contracts";
import { desc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { projects } from "./schema.js";

export function createProjectRepository(db: Database) {
  return {
    async createProject(name: string): Promise<Project> {
      const [created] = await db
        .insert(projects)
        .values({
          id: randomUUID(),
          name,
          createdAt: new Date(),
        })
        .returning();

      return created;
    },

    async listProjects(): Promise<Project[]> {
      return db
        .select()
        .from(projects)
        .orderBy(desc(projects.createdAt), desc(projects.id));
    },

    async getProjectById(id: string): Promise<Project | null> {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);

      return project ?? null;
    },
  };
}
