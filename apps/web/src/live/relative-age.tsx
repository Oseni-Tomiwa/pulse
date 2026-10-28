import { useSyncExternalStore } from "react";

let currentTime = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    currentTime = Date.now();
    timer = setInterval(() => {
      currentTime = Date.now();
      listeners.forEach(notify => notify());
    }, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { clearInterval(timer); timer = undefined; }
  };
}
function getSnapshot() { return currentTime; }

export function formatObservationAge(checkedAt: string, now: number) {
  const timestamp = Date.parse(checkedAt);
  if (!Number.isFinite(timestamp)) return "Time unavailable";
  const seconds = Math.floor(Math.max(0, now - timestamp) / 1_000);
  if (seconds < 1) return "Just now";
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hr ago`;
  const days = Math.floor(seconds / 86_400);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function RelativeAge({ checkedAt }: { checkedAt: string }) {
  const now = useSyncExternalStore(subscribe, getSnapshot);
  return <time dateTime={checkedAt} title={new Date(checkedAt).toLocaleString()}>Checked {formatObservationAge(checkedAt, now)}</time>;
}
