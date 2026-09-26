import type {
  HealthCheck,
  HttpMonitor,
  Incident,
  MonitorUptime,
  MonitorStatus,
  Project,
  Service,
  UptimeWindow,
} from "@pulse/contracts";
import type { CreateMonitorInput } from "@pulse/database";
import Fastify, { type FastifyServerOptions } from "fastify";

export type ProjectRepository = {
  createProject(name: string): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProjectById(id: string): Promise<Project | null>;
};

export type ServiceRepository = {
  createService(projectId: string, name: string): Promise<Service>;
  listServicesByProjectId(projectId: string): Promise<Service[]>;
  getServiceById(id: string): Promise<Service | null>;
};

export type MonitorRepository = {
  createMonitor(input: CreateMonitorInput): Promise<HttpMonitor>;
  listMonitorsByServiceId(serviceId: string): Promise<HttpMonitor[]>;
  getMonitorById(id: string): Promise<HttpMonitor | null>;
};

export type MonitoringReadRepository = {
  getRecentHealthChecks(monitorId: string, limit: number): Promise<HealthCheck[]>;
  getRecentIncidents(monitorId: string, limit: number): Promise<Incident[]>;
  getOpenIncident(monitorId: string): Promise<Incident | null>;
  getCheckBasedUptimeCounts(
    monitorId: string,
    from: Date,
    to: Date,
  ): Promise<{ totalChecks: number; healthyChecks: number }>;
};

export type AppRepositories = {
  projects: ProjectRepository;
  services: ServiceRepository;
  monitors: MonitorRepository;
  monitoring: MonitoringReadRepository;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;
const UPTIME_WINDOW_MS: Record<UptimeWindow, number> = {
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

function parseHistoryLimit(value: unknown): number | null {
  if (value === undefined) return DEFAULT_HISTORY_LIMIT;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit <= MAX_HISTORY_LIMIT ? limit : null;
}

function parseUptimeWindow(value: unknown): UptimeWindow | null {
  if (value === undefined) return "24h";
  return value === "24h" || value === "7d" || value === "30d"
    ? value
    : null;
}

function isClientError(error: unknown): error is { statusCode: number; message: string } {
  return error instanceof Error &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode < 500;
}

export function buildApp(
  repositories: AppRepositories,
  options: FastifyServerOptions = { logger: true },
  now: () => Date = () => new Date(),
) {
  const app = Fastify(options);
  const {
    projects: projectRepository,
    services: serviceRepository,
    monitors: monitorRepository,
    monitoring: monitoringRepository,
  } = repositories;

  app.setErrorHandler((error, request, reply) => {
    if (isClientError(error)) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    request.log.error({ err: error }, "Unexpected API error");
    return reply.status(500).send({ error: "Internal Server Error" });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "pulse-api",
  }));

  app.post("/projects", async (request, reply) => {
    const body = request.body as { name?: unknown } | null;
    if (!body || typeof body.name !== "string" || body.name.trim().length === 0) {
      return reply.status(400).send({
        error: "Project name must be a non-empty string",
      });
    }

    const created = await projectRepository.createProject(body.name.trim());
    return reply.status(201).send(created);
  });

  app.get("/projects", async () => projectRepository.listProjects());

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId",
    async (request, reply) => {
      const { projectId } = request.params;
      if (!UUID_PATTERN.test(projectId)) {
        return reply.status(400).send({ error: "Invalid project ID" });
      }

      const project = await projectRepository.getProjectById(projectId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      return project;
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/services",
    async (request, reply) => {
      const { projectId } = request.params;
      if (!UUID_PATTERN.test(projectId)) {
        return reply.status(400).send({ error: "Invalid project ID" });
      }

      const body = request.body as { name?: unknown } | null;
      if (!body || typeof body.name !== "string" || body.name.trim().length === 0) {
        return reply.status(400).send({
          error: "Service name must be a non-empty string",
        });
      }

      if (!await projectRepository.getProjectById(projectId)) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const created = await serviceRepository.createService(
        projectId,
        body.name.trim(),
      );
      return reply.status(201).send(created);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/services",
    async (request, reply) => {
      const { projectId } = request.params;
      if (!UUID_PATTERN.test(projectId)) {
        return reply.status(400).send({ error: "Invalid project ID" });
      }

      if (!await projectRepository.getProjectById(projectId)) {
        return reply.status(404).send({ error: "Project not found" });
      }

      return serviceRepository.listServicesByProjectId(projectId);
    },
  );

  app.get<{ Params: { serviceId: string } }>(
    "/services/:serviceId",
    async (request, reply) => {
      const { serviceId } = request.params;
      if (!UUID_PATTERN.test(serviceId)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      const service = await serviceRepository.getServiceById(serviceId);
      if (!service) {
        return reply.status(404).send({ error: "Service not found" });
      }

      return service;
    },
  );

  app.post<{ Params: { serviceId: string } }>(
    "/services/:serviceId/monitors",
    async (request, reply) => {
      const { serviceId } = request.params;
      if (!UUID_PATTERN.test(serviceId)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }

      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body.name !== "string" || body.name.trim().length === 0) {
        return reply.status(400).send({
          error: "Monitor name must be a non-empty string",
        });
      }

      if (typeof body.url !== "string") {
        return reply.status(400).send({
          error: "Monitor URL must be a valid HTTP or HTTPS URL",
        });
      }
      const url = body.url.trim();
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new TypeError("Unsupported URL scheme");
        }
      } catch {
        return reply.status(400).send({
          error: "Monitor URL must be a valid HTTP or HTTPS URL",
        });
      }

      if (
        body.method !== undefined &&
        body.method !== "GET" &&
        body.method !== "HEAD"
      ) {
        return reply.status(400).send({ error: "Monitor method must be GET or HEAD" });
      }

      const integerFields = [
        "intervalMs",
        "timeoutMs",
        "failureThreshold",
        "recoveryThreshold",
      ] as const;
      for (const field of integerFields) {
        const value = body[field];
        if (
          value !== undefined &&
          (!Number.isSafeInteger(value) || (value as number) <= 0)
        ) {
          return reply.status(400).send({
            error: `${field} must be a positive safe integer`,
          });
        }
      }

      if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
        return reply.status(400).send({ error: "Monitor enabled must be a boolean" });
      }

      if (!await serviceRepository.getServiceById(serviceId)) {
        return reply.status(404).send({ error: "Service not found" });
      }

      const input: CreateMonitorInput = {
        serviceId,
        name: body.name.trim(),
        url,
      };
      if (body.method !== undefined) input.method = body.method;
      for (const field of integerFields) {
        const value = body[field];
        if (value !== undefined) input[field] = value as number;
      }
      if (body.enabled !== undefined) input.enabled = body.enabled;

      const created = await monitorRepository.createMonitor(input);
      return reply.status(201).send(created);
    },
  );

  app.get<{ Params: { serviceId: string } }>(
    "/services/:serviceId/monitors",
    async (request, reply) => {
      const { serviceId } = request.params;
      if (!UUID_PATTERN.test(serviceId)) {
        return reply.status(400).send({ error: "Invalid service ID" });
      }
      if (!await serviceRepository.getServiceById(serviceId)) {
        return reply.status(404).send({ error: "Service not found" });
      }
      return monitorRepository.listMonitorsByServiceId(serviceId);
    },
  );

  app.get<{ Params: { monitorId: string } }>(
    "/monitors/:monitorId",
    async (request, reply) => {
      const { monitorId } = request.params;
      if (!UUID_PATTERN.test(monitorId)) {
        return reply.status(400).send({ error: "Invalid monitor ID" });
      }
      const monitor = await monitorRepository.getMonitorById(monitorId);
      if (!monitor) {
        return reply.status(404).send({ error: "Monitor not found" });
      }
      return monitor;
    },
  );

  app.get<{
    Params: { monitorId: string };
    Querystring: { window?: unknown };
  }>("/monitors/:monitorId/uptime", async (request, reply) => {
    const { monitorId } = request.params;
    if (!UUID_PATTERN.test(monitorId)) {
      return reply.status(400).send({ error: "Invalid monitor ID" });
    }
    const window = parseUptimeWindow(request.query.window);
    if (window === null) {
      return reply.status(400).send({ error: "window must be 24h, 7d, or 30d" });
    }
    if (!await monitorRepository.getMonitorById(monitorId)) {
      return reply.status(404).send({ error: "Monitor not found" });
    }

    const to = now();
    const from = new Date(to.getTime() - UPTIME_WINDOW_MS[window]);
    const { totalChecks, healthyChecks } =
      await monitoringRepository.getCheckBasedUptimeCounts(monitorId, from, to);
    const uptimePercentage = totalChecks === 0
      ? null
      : Math.round((healthyChecks / totalChecks) * 100 * 10_000) / 10_000;
    const result: MonitorUptime = {
      monitorId,
      window,
      from,
      to,
      totalChecks,
      healthyChecks,
      unhealthyChecks: totalChecks - healthyChecks,
      uptimePercentage,
    };

    return result;
  });

  app.get<{
    Params: { monitorId: string };
    Querystring: { limit?: unknown };
  }>("/monitors/:monitorId/checks", async (request, reply) => {
    const { monitorId } = request.params;
    if (!UUID_PATTERN.test(monitorId)) {
      return reply.status(400).send({ error: "Invalid monitor ID" });
    }
    const limit = parseHistoryLimit(request.query.limit);
    if (limit === null) {
      return reply.status(400).send({
        error: "limit must be an integer between 1 and 200",
      });
    }
    if (!await monitorRepository.getMonitorById(monitorId)) {
      return reply.status(404).send({ error: "Monitor not found" });
    }
    return monitoringRepository.getRecentHealthChecks(monitorId, limit);
  });

  app.get<{
    Params: { monitorId: string };
    Querystring: { limit?: unknown };
  }>("/monitors/:monitorId/incidents", async (request, reply) => {
    const { monitorId } = request.params;
    if (!UUID_PATTERN.test(monitorId)) {
      return reply.status(400).send({ error: "Invalid monitor ID" });
    }
    const limit = parseHistoryLimit(request.query.limit);
    if (limit === null) {
      return reply.status(400).send({
        error: "limit must be an integer between 1 and 200",
      });
    }
    if (!await monitorRepository.getMonitorById(monitorId)) {
      return reply.status(404).send({ error: "Monitor not found" });
    }
    return monitoringRepository.getRecentIncidents(monitorId, limit);
  });

  app.get<{ Params: { monitorId: string } }>(
    "/monitors/:monitorId/status",
    async (request, reply) => {
      const { monitorId } = request.params;
      if (!UUID_PATTERN.test(monitorId)) {
        return reply.status(400).send({ error: "Invalid monitor ID" });
      }
      if (!await monitorRepository.getMonitorById(monitorId)) {
        return reply.status(404).send({ error: "Monitor not found" });
      }

      const [recentChecks, openIncident] = await Promise.all([
        monitoringRepository.getRecentHealthChecks(monitorId, 1),
        monitoringRepository.getOpenIncident(monitorId),
      ]);
      const latestCheck = recentChecks[0] ?? null;
      const probeStatus: MonitorStatus = latestCheck === null
        ? "unknown"
        : latestCheck.healthy ? "healthy" : "unhealthy";

      return { monitorId, probeStatus, latestCheck, openIncident };
    },
  );

  return app;
}
