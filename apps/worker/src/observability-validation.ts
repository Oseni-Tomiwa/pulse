import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createInterface, type Interface } from "node:readline";
import {
  createDatabase,
  createMonitoringRepository,
  monitors,
  projects,
  requireTestDatabaseUrl,
  services,
} from "@pulse/database";
import { checkHttp, executeHttpMonitor } from "@pulse/monitoring";
import { runMonitoringCycle } from "./run-monitoring-cycle.js";

const MONITOR_INTERVAL_MS = 60_000;
const MONITOR_TIMEOUT_MS = 10_000;
const lifecycle = [
  { name: "healthy", statusCode: 204 },
  { name: "first_failure", statusCode: 500 },
  { name: "second_failure", statusCode: 500 },
  { name: "incident_open", statusCode: 500 },
  { name: "recovered", statusCode: 204 },
] as const;

type LifecycleStage = "no_evidence" | (typeof lifecycle)[number]["name"];

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Validation HTTP server did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function main(): Promise<void> {
  const connectionString = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const { db, pool } = createDatabase(connectionString);
  const repository = createMonitoringRepository(db);
  const runId = randomUUID();
  const projectId = randomUUID();
  const serviceId = randomUUID();
  const monitorId = randomUUID();
  let responseStatus = 204;
  let completedStages = 0;
  let nextCycleAsOf = new Date();
  let serverListening = false;
  let cleanupPromise: Promise<boolean> | undefined;
  let input: Interface | undefined;
  let nextInProgress = false;
  let activeCommand: Promise<void> | undefined;
  let shutdownRequested = false;
  let finishInput!: () => void;
  const inputFinished = new Promise<void>((resolve) => { finishInput = resolve; });
  const server = createServer((_request, response) => {
    response.writeHead(responseStatus);
    response.end();
  });

  const fixtureDetails = () => ({
    projectId,
    serviceId,
    monitorId,
    browserRoute: `/monitors/${monitorId}`,
  });

  const cleanup = (): Promise<boolean> => {
    cleanupPromise ??= (async () => {
      const failedOperations: string[] = [];
      const attempt = async (name: string, operation: () => Promise<unknown>) => {
        try {
          await operation();
        } catch {
          failedOperations.push(name);
        }
      };

      await attempt("delete_health_checks", () =>
        pool.query("delete from health_checks where monitor_id = $1", [monitorId]));
      await attempt("delete_incidents", () =>
        pool.query("delete from incidents where monitor_id = $1", [monitorId]));
      await attempt("delete_monitor", () =>
        pool.query("delete from monitors where id = $1", [monitorId]));
      await attempt("delete_service", () =>
        pool.query("delete from services where id = $1", [serviceId]));
      await attempt("delete_project", () =>
        pool.query("delete from projects where id = $1", [projectId]));

      if (serverListening) {
        await attempt("close_http_server", async () => {
          await closeServer(server);
          serverListening = false;
        });
      }
      await attempt("close_database_pool", () => pool.end());

      if (failedOperations.length === 0) {
        console.log("Validation fixture cleaned up.");
        return true;
      }

      console.error(JSON.stringify({
        event: "observability.validation.cleanup_failed",
        ...fixtureDetails(),
        failedOperations,
        message: "Cleanup was incomplete; use the fixture IDs for manual exact-ID cleanup.",
      }));
      return false;
    })();
    return cleanupPromise;
  };

  const currentStage = (): LifecycleStage =>
    completedStages === 0 ? "no_evidence" : lifecycle[completedStages - 1].name;

  const loadState = async () => {
    const checks = await repository.getRecentHealthChecks(monitorId, 200);
    const incidentRows = await repository.getRecentIncidents(monitorId, 200);
    const openIncident = await repository.getOpenIncident(monitorId);
    return { checks, incidents: incidentRows, openIncident };
  };

  const assertPersistedStage = async (position: number): Promise<void> => {
    const state = await loadState();
    assert.equal(state.checks.length, position, `Expected ${position} persisted Health Checks`);

    if (position === 0) {
      assert.equal(state.incidents.length, 0, "Initial fixture unexpectedly has an Incident");
      assert.equal(state.openIncident, null, "Initial fixture unexpectedly has an open Incident");
      return;
    }

    const expectedHealthy = position === 1 || position === 5;
    const expectedStatusCode = expectedHealthy ? 204 : 500;
    assert.equal(state.checks[0]?.healthy, expectedHealthy, "Newest Health Check has unexpected health");
    assert.equal(state.checks[0]?.statusCode, expectedStatusCode, "Newest Health Check has unexpected HTTP status");

    if (position <= 3) {
      assert.equal(state.incidents.length, 0, "An Incident opened below the failure threshold");
      assert.equal(state.openIncident, null, "An open Incident exists below the failure threshold");
      return;
    }

    assert.equal(state.incidents.length, 1, "Expected exactly one Incident");
    if (position === 4) {
      assert.equal(state.incidents[0]?.status, "open", "Threshold Incident is not open");
      assert.equal(state.openIncident?.id, state.incidents[0]?.id, "Open Incident lookup disagrees with history");
      return;
    }

    assert.equal(state.incidents[0]?.status, "resolved", "Recovery did not resolve the Incident");
    assert(state.incidents[0]?.resolvedAt instanceof Date, "Resolved Incident has no resolution timestamp");
    assert.equal(state.openIncident, null, "An open Incident remained after recovery");
  };

  const printStatus = async (): Promise<void> => {
    const state = await loadState();
    const next = lifecycle[completedStages];
    console.log(JSON.stringify({
      event: "observability.validation.status",
      ...fixtureDetails(),
      stage: currentStage(),
      expectedNextHttpStatus: next?.statusCode ?? null,
      healthCheckCount: state.checks.length,
      incidentCount: state.incidents.length,
      openIncident: state.openIncident !== null,
    }));
  };

  const runNextStage = async (): Promise<void> => {
    if (completedStages >= lifecycle.length) {
      console.log("Lifecycle is complete. No additional monitoring cycle was run.");
      return;
    }

    const targetStage = lifecycle[completedStages];
    responseStatus = targetStage.statusCode;
    const asOf = nextCycleAsOf;
    let discoveredAsDue = false;
    const summary = await runMonitoringCycle({
      now: () => asOf,
      getDueHttpMonitors: async (discoveryTime) => {
        const dueMonitors = await repository.getDueHttpMonitors(discoveryTime);
        const fixtureMonitor = dueMonitors.find(({ id }) => id === monitorId);
        discoveredAsDue = fixtureMonitor !== undefined;
        return fixtureMonitor ? [fixtureMonitor] : [];
      },
      executeHttpMonitor: (monitor) => executeHttpMonitor(monitor, {
        checkHttp,
        persistence: repository,
      }),
    });

    assert.equal(discoveredAsDue, true, "Fixture Monitor was not discovered as due");
    assert.equal(summary.dueCount, 1, "Cycle did not receive exactly the fixture Monitor");
    assert.equal(summary.succeededCount, 1, "Fixture Monitor execution did not succeed");
    assert.equal(summary.failedCount, 0, "Fixture Monitor execution failed");
    const execution = summary.executions[0];
    assert(execution && execution.status === "succeeded", "Fixture execution result is missing");

    await assertPersistedStage(completedStages + 1);
    completedStages += 1;
    nextCycleAsOf = new Date(
      execution.result.healthCheck.checkedAt.getTime() + MONITOR_INTERVAL_MS + 1,
    );
    await printStatus();
  };

  const requestShutdown = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    input?.close();
    finishInput();
  };

  const onSignal = (signal: "SIGINT" | "SIGTERM") => {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    requestShutdown();
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));

  try {
    const port = await listen(server);
    serverListening = true;
    const createdAt = new Date();

    await db.insert(projects).values({
      id: projectId,
      name: `Pulse observability validation ${runId}`,
      createdAt,
    });
    await db.insert(services).values({
      id: serviceId,
      projectId,
      name: `Validation service ${runId}`,
      createdAt,
    });
    await db.insert(monitors).values({
      id: monitorId,
      serviceId,
      name: `Validation monitor ${runId}`,
      kind: "http",
      url: `http://127.0.0.1:${port}/health`,
      method: "GET",
      intervalMs: MONITOR_INTERVAL_MS,
      timeoutMs: MONITOR_TIMEOUT_MS,
      failureThreshold: 3,
      recoveryThreshold: 1,
      enabled: true,
      createdAt,
    });
    await assertPersistedStage(0);

    console.log(JSON.stringify({
      event: "observability.validation.ready",
      ...fixtureDetails(),
      stage: currentStage(),
      acceptedCommands: ["next", "status", "quit"],
    }));

    input = createInterface({ input: process.stdin, output: process.stdout });
    input.on("line", (line) => {
      const command = line.trim().toLowerCase();
      if (command === "quit") {
        requestShutdown();
        return;
      }
      if (command === "next") {
        if (nextInProgress || activeCommand) {
          console.log("A validation operation is already in progress.");
          return;
        }
        nextInProgress = true;
        activeCommand = runNextStage()
          .catch(() => {
            console.error(JSON.stringify({
              event: "observability.validation.stage_failed",
              ...fixtureDetails(),
              stage: lifecycle[completedStages]?.name ?? currentStage(),
              message: "Lifecycle execution or persisted-state assertion failed.",
            }));
            process.exitCode = 1;
            requestShutdown();
          })
          .finally(() => {
            nextInProgress = false;
            activeCommand = undefined;
          });
        return;
      }
      if (command === "status") {
        if (nextInProgress || activeCommand) {
          console.log("A validation operation is in progress. Try status again when it completes.");
          return;
        }
        activeCommand = printStatus()
          .catch(() => {
            console.error(JSON.stringify({
              event: "observability.validation.status_failed",
              ...fixtureDetails(),
              stage: currentStage(),
              message: "Persisted validation status could not be loaded.",
            }));
            process.exitCode = 1;
            requestShutdown();
          })
          .finally(() => { activeCommand = undefined; });
        return;
      }
      console.log("Unknown command. Accepted commands: next, status, quit.");
    });
    input.once("close", finishInput);

    await inputFinished;
    if (activeCommand) await activeCommand;
  } catch {
    console.error(JSON.stringify({
      event: "observability.validation.failed",
      ...fixtureDetails(),
      stage: currentStage(),
      message: "Validation setup or execution failed.",
    }));
    process.exitCode = 1;
  } finally {
    input?.close();
    const cleaned = await cleanup();
    if (!cleaned) process.exitCode = 1;
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
