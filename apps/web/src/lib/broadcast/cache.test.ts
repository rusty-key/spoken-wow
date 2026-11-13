import { describe, expect, it } from "vitest";

import { parseBroadcastCache } from "./cache";

const BROADCAST_TEXT = 0x021826bb;
const OTHER_TABLE = 0xe1432d63;

type Record = { table: number; id: number; status?: number; row: number[] };

const u32 = (v: number) => [...new Uint8Array(new Uint32Array([v]).buffer)];
const cstr = (s: string) => [...Buffer.from(s, "utf8"), 0];

function cache(build: number, records: Record[], trailing: number[] = []): ArrayBuffer {
  const bytes = [...Buffer.from("XFTH"), ...u32(9), ...u32(build), ...new Array(32).fill(7)];
  for (const { table, id, status = 1, row } of records) {
    bytes.push(...Buffer.from("XFTH"), ...u32(70), ...u32(0xffffffff), ...u32(0xffffffff));
    bytes.push(...u32(table), ...u32(id), ...u32(row.length), ...u32(status), ...row);
  }
  bytes.push(...trailing);
  return new Uint8Array(bytes).buffer;
}

const textRow = (text: string, text1: string) => [...cstr(text), ...cstr(text1), ...u32(0), 1, 0, 0, 0];

describe("parseBroadcastCache", () => {
  it("reads each BroadcastText row's id and both forms, with the client build", () => {
    const parsed = parseBroadcastCache(
      cache(70291, [
        { table: BROADCAST_TEXT, id: 2825, row: textRow("As the wind on the plains.", "As the wind on the plains.") },
        { table: BROADCAST_TEXT, id: 5969, row: textRow("Bienvenido a El Cruce, $C.", "") },
      ]),
    );
    expect(parsed).toEqual({
      build: 70291,
      texts: [
        { id: 2825, text: "As the wind on the plains.", text1: "As the wind on the plains." },
        { id: 5969, text: "Bienvenido a El Cruce, $C.", text1: "" },
      ],
    });
  });

  it("skips other tables and withdrawn rows", () => {
    const parsed = parseBroadcastCache(
      cache(70245, [
        { table: OTHER_TABLE, id: 110298, row: [1, 2, 3, 4] },
        { table: BROADCAST_TEXT, id: 1, status: 2, row: textRow("Gone.", "") },
        { table: BROADCAST_TEXT, id: 2, row: textRow("Kept.", "") },
      ]),
    );
    expect(parsed.texts).toEqual([{ id: 2, text: "Kept.", text1: "" }]);
  });

  it("keeps the whole records of a file cut off mid-record", () => {
    const parsed = parseBroadcastCache(
      cache(70245, [{ table: BROADCAST_TEXT, id: 3, row: textRow("Whole.", "") }], [...Buffer.from("XFTH"), 70, 0]),
    );
    expect(parsed.texts).toEqual([{ id: 3, text: "Whole.", text1: "" }]);
  });

  it("decodes UTF-8", () => {
    const parsed = parseBroadcastCache(cache(1, [{ table: BROADCAST_TEXT, id: 4, row: textRow("Grüße, $n.", "Привет") }]));
    expect(parsed.texts).toEqual([{ id: 4, text: "Grüße, $n.", text1: "Привет" }]);
  });

  it("refuses a file that is not a DBCache", () => {
    expect(() => parseBroadcastCache(new Uint8Array([...Buffer.from("BOMW"), ...new Array(60).fill(0)]).buffer)).toThrow(
      /DBCache/,
    );
  });
});
