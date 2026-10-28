import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const LiveContext = createContext({ version: 0, visible: true });

/** One network cadence per page, shared by its independently loaded resources. */
export function LiveRefresh({ children }: { children: ReactNode }) {
  const [live, setLive] = useState(() => ({ version: 0, visible: document.visibilityState !== "hidden" }));
  useEffect(() => {
    function onVisibility() {
      const visible = document.visibilityState !== "hidden";
      setLive(current => current.visible === visible ? current
        : { visible, version: current.version + (visible ? 1 : 0) });
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (!live.visible) return;
    const timer = window.setInterval(() => setLive(current => ({ ...current, version: current.version + 1 })), 15_000);
    return () => window.clearInterval(timer);
  }, [live.visible]);
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export function LiveRefreshStatus() {
  const { visible } = useContext(LiveContext);
  return <p className="live-refresh-note">{visible ? "Auto-refresh every 15s" : "Auto-refresh paused while this tab is hidden"}</p>;
}

export function RefreshWarning({ failed, label = "Data" }: { failed: boolean; label?: string }) {
  return failed ? <p className="refresh-warning" role="status">{label} could not refresh. Showing last loaded data; retrying automatically.</p> : null;
}

type ResourceState<T> = { status: "loading" } | { status: "error"; cause: unknown }
  | { status: "success"; data: T; refreshFailed: boolean };

/** Identity changes discard old data; background refreshes preserve a successful snapshot. */
export function useLiveResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
  manualVersion = 0,
  enabled = true,
): ResourceState<T> & { setData(update: (data: T) => T): void } {
  const { version, visible } = useContext(LiveContext);
  const active = useRef<{ key: string; controller: AbortController; pending: boolean } | undefined>(undefined);
  const [stored, setStored] = useState<{ key: string; state: ResourceState<T> }>({ key, state: { status: "loading" } });
  const scheduledRequest = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled || !visible) return;
    function start() {
      // A slow response may span several ticks. Do not cancel or overlap it.
      if (active.current?.pending) return;
      const controller = new AbortController();
      active.current = { key, controller, pending: true };
      setStored(current => current.key === key && current.state.status === "success"
        ? current : { key, state: { status: "loading" } });
      void (async () => {
        try {
          const data = await load(controller.signal);
          if (!controller.signal.aborted) setStored({ key, state: { status: "success", data, refreshFailed: false } });
        } catch (cause) {
          if (controller.signal.aborted) return;
          setStored(current => ({ key, state: current.key === key && current.state.status === "success"
            ? { ...current.state, refreshFailed: true } : { status: "error", cause } }));
        } finally {
          if (active.current?.controller === controller) active.current.pending = false;
        }
      })();
    }
    scheduledRequest.current = start;
    start();
    return () => {
      active.current?.controller.abort();
      active.current = undefined;
      scheduledRequest.current = () => {};
    };
  }, [load, key, manualVersion, enabled, visible]);
  useEffect(() => { scheduledRequest.current(); }, [version]);
  const setData = useCallback((update: (data: T) => T) => {
    // A mutation is newer than any already-started collection read.
    if (active.current?.key === key) {
      active.current.controller.abort();
      active.current.pending = false;
    }
    setStored(current => current.key === key && current.state.status === "success"
      ? { key, state: { ...current.state, data: update(current.state.data) } } : current);
  }, [key]);
  return { ...(stored.key === key ? stored.state : { status: "loading" as const }), setData };
}
