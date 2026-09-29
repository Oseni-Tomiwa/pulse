import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  type ProjectResponse,
  type PulseApiClient,
  type ServiceResponse,
} from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/async-states";
import { CreateServiceForm } from "./create-service-form";
import { PageHeader } from "./page-header";

type ProjectState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error" }
  | { status: "success"; project: ProjectResponse };

type ServicesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; services: ServiceResponse[] };

export function ProjectDetailsPage({ apiClient }: { apiClient: PulseApiClient }) {
  const { projectId } = useParams();
  const [projectState, setProjectState] = useState<ProjectState>({ status: "loading" });
  const [servicesState, setServicesState] = useState<ServicesState>({ status: "idle" });
  const [projectRequestVersion, setProjectRequestVersion] = useState(0);
  const [servicesRequestVersion, setServicesRequestVersion] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (!projectId) {
      setProjectState({ status: "notFound" });
      return () => controller.abort();
    }

    setProjectState({ status: "loading" });
    setServicesState({ status: "idle" });
    setCreating(false);
    void apiClient.getProject(projectId, { signal: controller.signal }).then(
      (project) => {
        if (!controller.signal.aborted) setProjectState({ status: "success", project });
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setProjectState(cause instanceof ApiError && cause.status === 404
          ? { status: "notFound" }
          : { status: "error" });
      },
    );
    return () => controller.abort();
  }, [apiClient, projectId, projectRequestVersion]);

  useEffect(() => {
    if (projectState.status !== "success" || !projectId) return;

    const controller = new AbortController();
    setServicesState({ status: "loading" });
    setCreating(false);
    void apiClient.listServices(projectId, { signal: controller.signal }).then(
      (services) => {
        if (!controller.signal.aborted) setServicesState({ status: "success", services });
      },
      () => {
        if (!controller.signal.aborted) setServicesState({ status: "error" });
      },
    );
    return () => controller.abort();
  }, [apiClient, projectId, projectState.status, servicesRequestVersion]);

  function addCreatedService(service: ServiceResponse) {
    setServicesState((current) => current.status === "success"
      ? {
          status: "success",
          services: [service, ...current.services.filter(({ id }) => id !== service.id)],
        }
      : current);
    setCreating(false);
  }

  if (projectState.status === "loading") return <LoadingState label="Loading project" />;
  if (projectState.status === "error") {
    return (
      <ErrorState
        title="Project unavailable"
        description="Pulse could not load this Project."
        onRetry={() => setProjectRequestVersion((version) => version + 1)}
      />
    );
  }
  if (projectState.status === "notFound") {
    return (
      <div className="not-found-state">
        <PageHeader
          eyebrow="Project"
          title="Project not found"
          description="This Project does not exist or is no longer available."
        />
        <Link className="text-link" to="/projects">Back to Projects</Link>
      </div>
    );
  }

  return (
    <>
      <div className="page-toolbar">
        <PageHeader
          eyebrow="Project"
          title={projectState.project.name}
          description={`Created ${new Date(projectState.project.createdAt).toLocaleDateString()}`}
        />
        {servicesState.status === "success" && !creating ? (
          <button className="button" type="button" onClick={() => setCreating(true)}>
            Create Service
          </button>
        ) : null}
      </div>
      <section className="details-section" aria-labelledby="services-heading">
        <h2 id="services-heading">Services</h2>
        {servicesState.status === "idle" || servicesState.status === "loading"
          ? <LoadingState label="Loading services" />
          : null}
        {servicesState.status === "error" ? (
          <ErrorState
            title="Services unavailable"
            description="Pulse could not load this Project's Services."
            onRetry={() => setServicesRequestVersion((version) => version + 1)}
          />
        ) : null}
        {servicesState.status === "success" ? (
          <>
            {creating && projectId ? (
              <CreateServiceForm
                apiClient={apiClient}
                projectId={projectId}
                onCancel={() => setCreating(false)}
                onCreated={addCreatedService}
              />
            ) : null}
            {servicesState.services.length === 0 ? (
              <EmptyState
                title="No services yet"
                description="Create a Service to group the HTTP Monitors for one component."
              />
            ) : (
              <div className="service-grid">
                {servicesState.services.map((service) => (
                  <Link className="service-card" to={`/services/${service.id}`} key={service.id}>
                    <strong>{service.name}</strong>
                    <span>Created {new Date(service.createdAt).toLocaleDateString()}</span>
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>
    </>
  );
}
