import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, type PulseApiClient, type ServiceResponse } from "../api/client";
import { ErrorState, LoadingState } from "../components/async-states";
import { PageHeader } from "./page-header";

type ServiceState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error" }
  | { status: "success"; service: ServiceResponse };

export function ServiceDetailsPage({ apiClient }: { apiClient: PulseApiClient }) {
  const { serviceId } = useParams();
  const [state, setState] = useState<ServiceState>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!serviceId) {
      setState({ status: "notFound" });
      return () => controller.abort();
    }

    setState({ status: "loading" });
    void apiClient.getService(serviceId, { signal: controller.signal }).then(
      (service) => {
        if (!controller.signal.aborted) setState({ status: "success", service });
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setState(cause instanceof ApiError && cause.status === 404
          ? { status: "notFound" }
          : { status: "error" });
      },
    );
    return () => controller.abort();
  }, [apiClient, serviceId, requestVersion]);

  if (state.status === "loading") return <LoadingState label="Loading service" />;
  if (state.status === "error") {
    return (
      <ErrorState
        title="Service unavailable"
        description="Pulse could not load this Service."
        onRetry={() => setRequestVersion((version) => version + 1)}
      />
    );
  }
  if (state.status === "notFound") {
    return (
      <div className="not-found-state">
        <PageHeader
          eyebrow="Service"
          title="Service not found"
          description="This Service does not exist or is no longer available."
        />
        <Link className="text-link" to="/projects">Back to Projects</Link>
      </div>
    );
  }

  return (
    <>
      <Link className="text-link hierarchy-link" to={`/projects/${state.service.projectId}`}>
        Back to Project
      </Link>
      <PageHeader
        eyebrow="Project / Service"
        title={state.service.name}
        description={`Created ${new Date(state.service.createdAt).toLocaleDateString()}`}
      />
      <div className="future-section">
        <strong>Monitors</strong>
        <p>Monitor management is coming in a later milestone.</p>
      </div>
    </>
  );
}
