import { useState, type FormEvent } from "react";
import { ApiError, type PulseApiClient, type ServiceResponse } from "../api/client";

export function CreateServiceForm({
  apiClient,
  projectId,
  onCancel,
  onCreated,
}: {
  apiClient: PulseApiClient;
  projectId: string;
  onCancel: () => void;
  onCreated: (service: ServiceResponse) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a service name.");
      return;
    }

    setError(undefined);
    setPending(true);
    try {
      onCreated(await apiClient.createService(projectId, { name: trimmedName }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to create service. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="create-service-form" onSubmit={submit}>
      <div>
        <label htmlFor="service-name">Service name</label>
        <input
          id="service-name"
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </div>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button className="button button-secondary" type="button" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Creating service" : "Create service"}
        </button>
      </div>
    </form>
  );
}
