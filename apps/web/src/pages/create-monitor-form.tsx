import { useState, type FormEvent } from "react";
import {
  ApiError,
  type CreateMonitorInput,
  type MonitorResponse,
  type PulseApiClient,
} from "../api/client";

const numericFields = [
  ["intervalMs", "Interval"],
  ["timeoutMs", "Timeout"],
  ["failureThreshold", "Failure threshold"],
  ["recoveryThreshold", "Recovery threshold"],
] as const;

export function CreateMonitorForm({
  apiClient,
  serviceId,
  onCancel,
  onCreated,
}: {
  apiClient: PulseApiClient;
  serviceId: string;
  onCancel: () => void;
  onCreated: (monitor: MonitorResponse) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<"GET" | "HEAD">("GET");
  const [intervalMs, setIntervalMs] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("");
  const [failureThreshold, setFailureThreshold] = useState("");
  const [recoveryThreshold, setRecoveryThreshold] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const values = { intervalMs, timeoutMs, failureThreshold, recoveryThreshold };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName) {
      setError("Enter a monitor name.");
      return;
    }

    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    } catch {
      setError("Enter an absolute HTTP or HTTPS URL.");
      return;
    }

    const input: CreateMonitorInput = { name: trimmedName, url: trimmedUrl };
    for (const [field, label] of numericFields) {
      const raw = values[field];
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value <= 0) {
        setError(label + " must be a positive safe integer.");
        return;
      }
      input[field] = value;
    }
    if (method !== "GET") input.method = method;
    if (!enabled) input.enabled = false;

    setError(undefined);
    setPending(true);
    try {
      onCreated(await apiClient.createMonitor(serviceId, input));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to create monitor. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="create-monitor-form" onSubmit={submit}>
      <div className="form-grid">
        <div>
          <label htmlFor="monitor-name">Monitor name</label>
          <input id="monitor-name" value={name} disabled={pending} onChange={(event) => setName(event.target.value)} autoFocus />
        </div>
        <div>
          <label htmlFor="monitor-url">URL</label>
          <input id="monitor-url" type="url" value={url} disabled={pending} placeholder="https://example.com/health" onChange={(event) => setUrl(event.target.value)} />
        </div>
        <div>
          <label htmlFor="monitor-method">HTTP method</label>
          <select id="monitor-method" value={method} disabled={pending} onChange={(event) => setMethod(event.target.value as "GET" | "HEAD")}>
            <option value="GET">GET (default)</option>
            <option value="HEAD">HEAD</option>
          </select>
        </div>
        <div>
          <label htmlFor="monitor-interval">Interval (ms)</label>
          <input id="monitor-interval" type="number" step="any" value={intervalMs} disabled={pending} placeholder="60000 (default)" onChange={(event) => setIntervalMs(event.target.value)} />
        </div>
        <div>
          <label htmlFor="monitor-timeout">Timeout (ms)</label>
          <input id="monitor-timeout" type="number" step="any" value={timeoutMs} disabled={pending} placeholder="10000 (default)" onChange={(event) => setTimeoutMs(event.target.value)} />
        </div>
        <div>
          <label htmlFor="monitor-failure-threshold">Failure threshold</label>
          <input id="monitor-failure-threshold" type="number" step="any" value={failureThreshold} disabled={pending} placeholder="3 (default)" onChange={(event) => setFailureThreshold(event.target.value)} />
        </div>
        <div>
          <label htmlFor="monitor-recovery-threshold">Recovery threshold</label>
          <input id="monitor-recovery-threshold" type="number" step="any" value={recoveryThreshold} disabled={pending} placeholder="1 (default)" onChange={(event) => setRecoveryThreshold(event.target.value)} />
        </div>
      </div>
      <label className="checkbox-field">
        <input type="checkbox" checked={enabled} disabled={pending} onChange={(event) => setEnabled(event.target.checked)} />
        Monitoring enabled
      </label>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button className="button button-secondary" type="button" disabled={pending} onClick={onCancel}>Cancel</button>
        <button className="button" type="submit" disabled={pending}>{pending ? "Creating monitor" : "Create monitor"}</button>
      </div>
    </form>
  );
}
