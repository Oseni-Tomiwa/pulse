import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
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

const HEALTHY_STATUS = 204;
const UNHEALTHY_STATUS = 500;
const MONITOR_INTERVAL_MS = 60_000;

type StoredCheck = {
  healthy: boolean;
  status_code: number | null;
  latency_ms: number;
  error_type: string | null;
};

type StoredIncident = {
  id: string;
  status: string;
  started_at: Date;
  resolved_at: Date | null;
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Smoke-test HTTP server did not expose a TCP port"));
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
  const connectionString = requireTestDatabaseUrl(
    process.env.TEST_DATABASE_URL,
    process.env.DATABASE_URL,
  );
  const { db, pool } = createDatabase(connectionString);
  const repository = createMonitoringRepository(db);
  const runId = randomUUID();
  const projectId = randomUUID();
  const serviceId = randomUUID();
  const monitorId = randomUUID();
  let responseStatus = HEALTHY_STATUS;
  const server = createServer((_request, response) => {
    response.writeHead(responseStatus);
    response.end();
  });
  let serverListening = false;
  let failure: unknown;

  try {
    const port = await listen(server);
    serverListening = true;
    const createdAt = new Date();

    await db.insert(projects).values({
      id: projectId,
      name: `Pulse smoke project ${runId}`,
      createdAt,
    });
    await db.insert(services).values({
      id: serviceId,
      projectId,
      name: `Pulse smoke service ${runId}`,
      createdAt,
    });
    await db.insert(monitors).values({
      id: monitorId,
      serviceId,
      name: `Pulse smoke monitor ${runId}`,
      url: `http://127.0.0.1:${port}/health`,
      intervalMs: MONITOR_INTERVAL_MS,
      timeoutMs: 5_000,
      failureThreshold: 3,
      recoveryThreshold: 1,
      enabled: true,
      createdAt,
    });

    let nextCycleAsOf = new Date();
    const runFixtureCycle = async (status: number) => {
      responseStatus = status;
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

      assert.equal(discoveredAsDue, true, "Fixture monitor was not discovered as due");
      assert.equal(summary.dueCount, 1, "Cycle did not receive exactly the fixture monitor");
      assert.equal(summary.succeededCount, 1, "Fixture monitor execution did not succeed");
      assert.equal(summary.failedCount, 0, "Fixture monitor execution failed");
      const execution = summary.executions[0];
      assert(execution && execution.status === "succeeded");
      nextCycleAsOf = new Date(
        execution.result.healthCheck.checkedAt.getTime() + MONITOR_INTERVAL_MS + 1,
      );
      return execution.result;
    };

    const loadChecks = async () => (await pool.query<StoredCheck>(
      `select healthy, status_code, latency_ms, error_type
       from health_checks
       where monitor_id = $1
       order by checked_at asc, id asc`,
      [monitorId],
    )).rows;
    const loadIncidents = async () => (await pool.query<StoredIncident>(
      `select id, status, started_at, resolved_at
       from incidents
       where monitor_id = $1
       order by started_at asc`,
      [monitorId],
    )).rows;

    const healthyResult = await runFixtureCycle(HEALTHY_STATUS);
    assert.equal(healthyResult.incidentDecision, "none");
    let checks = await loadChecks();
    assert.equal(checks.length, 1, "Expected one check after the healthy cycle");
    assert.equal(checks[0].healthy, true, "Initial health check was not healthy");
    assert.equal(
      checks[0].status_code,
      HEALTHY_STATUS,
      "Initial health check had an unexpected HTTP status",
    );
    assert.equal(
      Number.isInteger(checks[0].latency_ms) && checks[0].latency_ms >= 0,
      true,
      "Initial health check had an invalid latency",
    );
    assert.equal((await loadIncidents()).length, 0, "Healthy cycle opened an incident");

    const firstFailure = await runFixtureCycle(UNHEALTHY_STATUS);
    assert.equal(firstFailure.incidentDecision, "none");
    checks = await loadChecks();
    assert.equal(checks.length, 2, "Expected two checks after the first failure");
    assert.equal(checks[1].healthy, false, "First failure was persisted as healthy");
    assert.equal(checks[1].status_code, UNHEALTHY_STATUS);
    assert.equal(checks[1].error_type, "http_error");
    assert.equal((await loadIncidents()).length, 0, "First failure opened an incident");

    const secondFailure = await runFixtureCycle(UNHEALTHY_STATUS);
    assert.equal(secondFailure.incidentDecision, "none");
    checks = await loadChecks();
    assert.equal(checks.length, 3, "Expected three checks after the second failure");
    assert.equal(checks[2].healthy, false, "Second failure was persisted as healthy");
    assert.equal(checks[2].status_code, UNHEALTHY_STATUS);
    assert.equal(checks[2].error_type, "http_error");
    assert.equal((await loadIncidents()).length, 0, "Second failure opened an incident");

    const thirdFailure = await runFixtureCycle(UNHEALTHY_STATUS);
    assert.equal(thirdFailure.incidentDecision, "open");
    assert.equal(thirdFailure.incidentWritten, true);
    checks = await loadChecks();
    assert.equal(checks.length, 4, "Expected four checks after the third failure");
    assert.equal(checks[3].healthy, false, "Third failure was persisted as healthy");
    assert.equal(checks[3].status_code, UNHEALTHY_STATUS);
    assert.equal(checks[3].error_type, "http_error");
    let incidentRows = await loadIncidents();
    assert.equal(incidentRows.length, 1, "Failure threshold did not create one incident");
    assert.equal(incidentRows[0].status, "open");
    assert(incidentRows[0].started_at instanceof Date);
    assert.equal(Number.isNaN(incidentRows[0].started_at.getTime()), false);
    assert.equal(
      incidentRows[0].started_at.getTime(),
      thirdFailure.healthCheck.checkedAt.getTime(),
      "Incident start time did not match the threshold-reaching check",
    );
    assert.equal(incidentRows[0].resolved_at, null);

    const recovery = await runFixtureCycle(HEALTHY_STATUS);
    assert.equal(recovery.incidentDecision, "resolve");
    assert.equal(recovery.incidentWritten, true);
    checks = await loadChecks();
    assert.equal(checks.length, 5, "Expected five total health checks after recovery");
    assert.equal(checks[4].healthy, true, "Recovery check was not persisted as healthy");
    assert.equal(checks[4].status_code, HEALTHY_STATUS);
    assert.equal(checks[4].error_type, null);
    assert.equal(
      Number.isInteger(checks[4].latency_ms) && checks[4].latency_ms >= 0,
      true,
      "Recovery check had an invalid latency",
    );
    incidentRows = await loadIncidents();
    assert.equal(incidentRows.length, 1, "Recovery created an unexpected second incident");
    assert.equal(incidentRows[0].status, "resolved");
    assert(incidentRows[0].resolved_at instanceof Date);
    assert.equal(Number.isNaN(incidentRows[0].resolved_at.getTime()), false);
    assert.equal(
      incidentRows[0].resolved_at.getTime(),
      recovery.healthCheck.checkedAt.getTime(),
      "Incident resolution time did not match the recovery check",
    );
    assert(incidentRows[0].resolved_at >= incidentRows[0].started_at);
    assert.equal(
      incidentRows.filter(({ status }) => status === "open").length,
      0,
      "An open incident remained after recovery",
    );

    console.log(JSON.stringify({
      event: "worker.smoke_test.passed",
      monitorId,
      healthCheckCount: checks.length,
      incidentCount: incidentRows.length,
      incidentStatus: incidentRows[0].status,
    }));
  } catch (error) {
    failure = error;
  } finally {
    try {
      await pool.query("delete from health_checks where monitor_id = $1", [monitorId]);
      await pool.query("delete from incidents where monitor_id = $1", [monitorId]);
      await pool.query("delete from monitors where id = $1", [monitorId]);
      await pool.query("delete from services where id = $1", [serviceId]);
      await pool.query("delete from projects where id = $1", [projectId]);
    } catch (cleanupError) {
      failure ??= cleanupError;
    }

    if (serverListening) {
      try {
        await closeServer(server);
      } catch (serverError) {
        failure ??= serverError;
      }
    }

    try {
      await pool.end();
    } catch (poolError) {
      failure ??= poolError;
    }
  }

  if (failure) throw failure;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "worker.smoke_test.failed", message }));
  process.exitCode = 1;
});
