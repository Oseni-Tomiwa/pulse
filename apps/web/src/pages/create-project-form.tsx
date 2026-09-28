import { useState, type FormEvent } from "react";
import { ApiError, type ProjectResponse, type PulseApiClient } from "../api/client";

export function CreateProjectForm({
  apiClient,
  onCancel,
  onCreated,
}: {
  apiClient: PulseApiClient;
  onCancel: () => void;
  onCreated: (project: ProjectResponse) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a project name.");
      return;
    }

    setError(undefined);
    setPending(true);
    try {
      onCreated(await apiClient.createProject({ name: trimmedName }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to create project. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="create-project-form" onSubmit={submit}>
      <div>
        <label htmlFor="project-name">Project name</label>
        <input
          id="project-name"
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
          {pending ? "Creating project" : "Create project"}
        </button>
      </div>
    </form>
  );
}
