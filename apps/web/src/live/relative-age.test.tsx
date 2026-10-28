import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatObservationAge, RelativeAge } from "./relative-age";

const now = Date.parse("2026-10-28T12:00:00Z");
afterEach(() => { vi.useRealTimers(); });
describe("relative observation age", () => {
  it.each([[0,"Just now"],[18_000,"18 sec ago"],[120_000,"2 min ago"],[14_400_000,"4 hr ago"],[172_800_000,"2 days ago"],[86_400_000,"1 day ago"],[-1000,"Just now"]])("formats age %i", (age, expected) => {
    expect(formatObservationAge(new Date(now - age).toISOString(), now)).toBe(expected);
  });
  it("handles an invalid timestamp honestly", () => { expect(formatObservationAge("invalid", now)).toBe("Time unavailable"); });
  it("updates multiple labels with one local timer and releases it on unmount", () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const checkedAt = new Date(now - 18_000).toISOString();
    const view = render(<><RelativeAge checkedAt={checkedAt} /><RelativeAge checkedAt={checkedAt} /></>);
    expect(screen.getAllByText("Checked 18 sec ago")).toHaveLength(2); expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(42_000); }); expect(screen.getAllByText("Checked 1 min ago")).toHaveLength(2);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
