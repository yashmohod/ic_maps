import { describe, expect, it, vi } from "vitest";
import { waitForMapIdle } from "@/lib/mymaps-export-image";

describe("waitForMapIdle", () => {
  it("resolves on the next idle after triggerRepaint", async () => {
    const listeners: Array<() => void> = [];
    const map = {
      once: (_type: "idle", listener: () => void) => {
        listeners.push(listener);
      },
      triggerRepaint: vi.fn(() => {
        queueMicrotask(() => listeners.forEach((l) => l()));
      }),
    };
    await waitForMapIdle(map);
    expect(map.triggerRepaint).toHaveBeenCalledOnce();
  });
});
