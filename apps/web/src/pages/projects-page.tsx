import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectResponse, PulseApiClient } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/async-states";
import { CreateProjectForm } from "./create-project-form";
import { PageHeader } from "./page-header";

type ProjectsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; projects: ProjectResponse[] };

export function ProjectsPage({ apiClient }: { apiClient: PulseApiClient }) {
  const [state, setState] = useState<ProjectsState>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    setCreating(false);
    void apiClient.listProjects({ signal: controller.signal }).then(
      (projects) => { if (!controller.signal.aborted) setState({ status: "success", projects }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [apiClient, requestVersion]);

  function addCreatedProject(project: ProjectResponse) {
    setState((current) => current.status === "success"
      ? {
          status: "success",
          projects: [project, ...current.projects.filter(({ id }) => id !== project.id)],
        }
      : current);
    setCreating(false);
  }

  return (
    <>
      <div className="page-toolbar">
        <PageHeader
          eyebrow="Workspace"
          title="Projects"
          description="Products and applications monitored by Pulse."
        />
        {state.status === "success" && !creating ? (
          <button className="button" type="button" onClick={() => setCreating(true)}>
            Create Project
          </button>
        ) : null}
      </div>

      {state.status === "loading" ? <LoadingState label="Loading projects" /> : null}
      {state.status === "error" ? (
        <ErrorState
          title="Projects unavailable"
          description="Pulse could not load the project collection."
          onRetry={() => setRequestVersion((version) => version + 1)}
        />
      ) : null}
      {state.status === "success" ? (
        <div className="projects-content">
          {creating ? (
            <CreateProjectForm
              apiClient={apiClient}
              onCancel={() => setCreating(false)}
              onCreated={addCreatedProject}
            />
          ) : null}
          {state.projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Create a Project to start organizing the services Pulse will monitor."
            />
          ) : (
            <div className="project-grid">
              {state.projects.map((project) => (
                <Link className="project-card" to={`/projects/${project.id}`} key={project.id}>
                  <strong>{project.name}</strong>
                  <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
