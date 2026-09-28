import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, type ProjectResponse, type PulseApiClient } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/async-states";
import { PageHeader } from "./page-header";

type ProjectState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error" }
  | { status: "success"; project: ProjectResponse };

export function ProjectDetailsPage({ apiClient }: { apiClient: PulseApiClient }) {
  const { projectId } = useParams();
  const [state, setState] = useState<ProjectState>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!projectId) {
      setState({ status: "notFound" });
      return () => controller.abort();
    }

    setState({ status: "loading" });
    void apiClient.getProject(projectId, { signal: controller.signal }).then(
      (project) => { if (!controller.signal.aborted) setState({ status: "success", project }); },
      (cause) => {
        if (controller.signal.aborted) return;
        setState(cause instanceof ApiError && cause.status === 404
          ? { status: "notFound" }
          : { status: "error" });
      },
    );
    return () => controller.abort();
  }, [apiClient, projectId, requestVersion]);

  if (state.status === "loading") return <LoadingState label="Loading project" />;
  if (state.status === "error") {
    return (
      <ErrorState
        title="Project unavailable"
        description="Pulse could not load this Project."
        onRetry={() => setRequestVersion((version) => version + 1)}
      />
    );
  }
  if (state.status === "notFound") {
    return (
      <div className="not-found-state">
        <PageHeader eyebrow="Project" title="Project not found" description="This Project does not exist or is no longer available." />
        <Link className="text-link" to="/projects">Back to Projects</Link>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title={state.project.name}
        description={`Created ${new Date(state.project.createdAt).toLocaleDateString()}`}
      />
      <div className="details-section">
        <EmptyState
          title="Services"
          description="Services will appear here when that workflow is available."
        />
      </div>
    </>
  );
}
