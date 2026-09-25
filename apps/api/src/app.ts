import type { Project, Service } from "@pulse/contracts";
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

export type AppRepositories = {
  projects: ProjectRepository;
  services: ServiceRepository;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isClientError(error: unknown): error is { statusCode: number; message: string } {
  return error instanceof Error &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode < 500;
}

export function buildApp(
  repositories: AppRepositories,
  options: FastifyServerOptions = { logger: true },
) {
  const app = Fastify(options);
  const { projects: projectRepository, services: serviceRepository } = repositories;

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

  return app;
}
