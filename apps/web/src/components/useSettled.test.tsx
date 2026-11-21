// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { useSettled } from "./useSettled";

afterEach(cleanup);

/**
 * A promise as React streams it from a server component: its `then` registers the callbacks
 * and returns nothing, so a chain built on it throws. Both pages crashed on mount that way.
 */
function streamed<T>(outcome: { value: T } | { reason: unknown }): Promise<T> {
  return {
    then(resolve?: (value: T) => void, reject?: (reason: unknown) => void) {
      if ("value" in outcome) resolve?.(outcome.value);
      else reject?.(outcome.reason);
    },
  } as unknown as Promise<T>;
}

test("is undefined while pending, and for no promise at all", () => {
  expect(renderHook(() => useSettled(new Promise(() => {}))).result.current).toBeUndefined();
  expect(renderHook(() => useSettled(null)).result.current).toBeUndefined();
});

test("settles a streamed promise's value", async () => {
  const promise = streamed({ value: 42 });
  const { result } = renderHook(() => useSettled(promise));
  await waitFor(() => expect(result.current).toEqual({ value: 42 }));
});

test("holds a streamed rejection as its message rather than throwing", async () => {
  const promise = streamed<number>({ reason: new Error("ElevenLabs did not answer") });
  const { result } = renderHook(() => useSettled(promise));
  await waitFor(() => expect(result.current).toEqual({ error: "ElevenLabs did not answer" }));
});
