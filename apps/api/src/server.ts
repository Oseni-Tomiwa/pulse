import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDatabase,
  createMonitorRepository,
  createProjectRepository,
  createServiceRepository,
} from "@pulse/database";
import { buildApp } from "./app.js";

export async function startServer(): Promise<void> {
  const { db, pool } = createDatabase();
  const app = buildApp({
    projects: createProjectRepository(db),
    services: createServiceRepository(db),
    monitors: createMonitorRepository(db),
  });
  let shuttingDown = false;

  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "Shutting down Pulse API");

    try {
      await app.close();
      await pool.end();
    } catch (error) {
      app.log.error(error, "Pulse API shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

  try {
    await app.listen({ port: 3000, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    await pool.end();
    throw error;
  }
}

const executablePath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executablePath === fileURLToPath(import.meta.url)) {
  void startServer().catch(() => {
    process.exitCode = 1;
  });
}
