import type { SiteText } from "./en";

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** A language's file: whatever it has translated, over English for what it has not. */
export type Dictionary = DeepPartial<SiteText>;
