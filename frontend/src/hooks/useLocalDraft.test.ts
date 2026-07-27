import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalDraft } from "./useLocalDraft";

const PREFIX = "kartavya-draft:";

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

async function waitForWrite(key: string) {
  await waitFor(() => expect(localStorage.getItem(PREFIX + key)).not.toBeNull());
}

describe("useLocalDraft", () => {
  it("starts from initialValue when nothing is stored", () => {
    const { result } = renderHook(() => useLocalDraft("fresh", "hello"));
    expect(result.current[0]).toBe("hello");
    expect(result.current[2].hasDraft).toBe(false);
  });

  it("restores a previously written draft, debounced", async () => {
    const { result, unmount } = renderHook(() => useLocalDraft("resume", ""));
    act(() => result.current[1]("in progress"));
    await waitForWrite("resume");
    unmount();

    const { result: second } = renderHook(() => useLocalDraft("resume", ""));
    expect(second.current[0]).toBe("in progress");
    expect(second.current[2].hasDraft).toBe(true);
  });

  it("flushes the pending debounced write on unmount instead of dropping it", async () => {
    // Regression test: the cleanup used to only *cancel* the pending
    // timeout, so navigating away inside the 300ms debounce window lost
    // whatever was typed in that window.
    const { result, unmount } = renderHook(() => useLocalDraft("flush-on-unmount", ""));
    act(() => result.current[1]("typed just before leaving"));
    // Deliberately not waiting out the debounce — unmount should flush it.
    unmount();

    expect(localStorage.getItem(PREFIX + "flush-on-unmount")).not.toBeNull();
    const { result: reloaded } = renderHook(() => useLocalDraft("flush-on-unmount", ""));
    expect(reloaded.current[0]).toBe("typed just before leaving");
  });

  it("clearDraft cancels a write still in flight, so the draft doesn't reappear", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLocalDraft("clear-race", ""));
    act(() => result.current[1]("about to be discarded"));
    act(() => result.current[2].clearDraft());
    // Advance past the debounce window that was pending when clearDraft ran.
    act(() => vi.advanceTimersByTime(500));

    expect(localStorage.getItem(PREFIX + "clear-race")).toBeNull();
  });

  it("ignores a draft saved under a different version", async () => {
    const { result: original, unmount } = renderHook(() =>
      useLocalDraft("versioned", { step: 1 }, { version: 1 }),
    );
    act(() => original.current[1]({ step: 2 }));
    await waitForWrite("versioned");
    unmount();

    const { result: bumped } = renderHook(() =>
      useLocalDraft("versioned", { step: 1 }, { version: 2 }),
    );
    expect(bumped.current[0]).toEqual({ step: 1 });
    expect(bumped.current[2].hasDraft).toBe(false);
  });

  it("ignores a draft older than maxAgeMs", async () => {
    const { result, unmount } = renderHook(() =>
      useLocalDraft("stale", "", { maxAgeMs: 1000 }),
    );
    act(() => result.current[1]("forgotten"));
    await waitForWrite("stale");
    unmount();

    vi.useFakeTimers();
    vi.advanceTimersByTime(5000);
    const { result: reloaded } = renderHook(() =>
      useLocalDraft("stale", "", { maxAgeMs: 1000 }),
    );
    expect(reloaded.current[0]).toBe("");
    expect(reloaded.current[2].hasDraft).toBe(false);
  });

  it("runs sanitize only on a value actually recovered from storage", async () => {
    const sanitize = vi.fn((v: { step: number }) => ({ step: Math.min(v.step, 1) }));

    const { unmount } = renderHook(() =>
      useLocalDraft("sanitize-fresh", { step: 0 }, { sanitize }),
    );
    unmount();
    expect(sanitize).not.toHaveBeenCalled();

    const { result: withData, unmount: unmount2 } = renderHook(() =>
      useLocalDraft("sanitize-restore", { step: 0 }, { sanitize }),
    );
    act(() => withData.current[1]({ step: 3 }));
    await waitForWrite("sanitize-restore");
    unmount2();

    const { result: restored } = renderHook(() =>
      useLocalDraft("sanitize-restore", { step: 0 }, { sanitize }),
    );
    expect(restored.current[0]).toEqual({ step: 1 });
  });

  it("treats a foreign (non-envelope) localStorage value as no draft", () => {
    localStorage.setItem(PREFIX + "foreign", JSON.stringify("just a raw string"));
    const { result } = renderHook(() => useLocalDraft("foreign", "default"));
    expect(result.current[0]).toBe("default");
    expect(result.current[2].hasDraft).toBe(false);
  });

  it("treats corrupted JSON as no draft rather than throwing", () => {
    localStorage.setItem(PREFIX + "corrupt", "{not json");
    expect(() => renderHook(() => useLocalDraft("corrupt", "default"))).not.toThrow();
  });
});
