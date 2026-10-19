import { describe, expect, it, vi } from "vitest";

import { alignerCommand, alignTake, readAligned, type Run } from "./word-times";

describe("alignerCommand", () => {
  it("splits the environment's command line into a program and its arguments", () => {
    expect(alignerCommand("python3  /srv/spoken/pipelines/timings/align.py")).toEqual({
      file: "python3",
      args: ["/srv/spoken/pipelines/timings/align.py"],
    });
  });

  it("is null when nothing is set", () => {
    expect(alignerCommand(undefined)).toBeNull();
    expect(alignerCommand("  ")).toBeNull();
  });
});

describe("readAligned", () => {
  it("takes the last JSON line, past whatever the model loader printed", () => {
    const out = 'Lightning upgraded your checkpoint\n{"times":"AAAB","matched":0.97}\n';
    expect(readAligned(out)).toEqual({ times: "AAAB", matched: 0.97 });
  });

  it("is null for output with no times in it", () => {
    expect(readAligned("")).toBeNull();
    expect(readAligned("{not json")).toBeNull();
    expect(readAligned('{"matched":1}')).toBeNull();
  });
});

describe("alignTake", () => {
  const command = { file: "python3", args: ["align.py"] };

  it("hands the aligner the audio, the text in a file and the language", async () => {
    const run = vi.fn<Run>(async () => ({ stdout: '{"times":"AAAB","matched":1}' }));
    const found = await alignTake("take.mp3", "one two", "enUS", run, command);

    expect(found).toEqual({ times: "AAAB", matched: 1 });
    const [file, args] = run.mock.calls[0];
    expect(file).toBe("python3");
    expect(args.slice(0, 4)).toEqual(["align.py", "--clip", "take.mp3", "--text-file"]);
    expect(args.slice(5)).toEqual(["--language", "en"]);
  });

  it("does not run without a command or without text", async () => {
    const run = vi.fn<Run>(async () => ({ stdout: "" }));
    expect(await alignTake("take.mp3", "one two", "enUS", run, null)).toBeNull();
    expect(await alignTake("take.mp3", "   ", "enUS", run, command)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("is null, not an error, when the aligner fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const run: Run = async () => {
      throw new Error("boom");
    };
    expect(await alignTake("take.mp3", "one two", "enUS", run, command)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
