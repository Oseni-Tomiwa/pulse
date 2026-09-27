import type { ReactNode } from "react";

type StateProps = {
  title: string;
  description?: string;
};

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="async-state" role="status" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
}: StateProps & { onRetry?: () => void }) {
  return (
    <div className="async-state" role="alert">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {onRetry ? <button type="button" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: StateProps & { action?: ReactNode }) {
  return (
    <div className="async-state empty-state">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
