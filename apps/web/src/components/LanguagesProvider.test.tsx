// @vitest-environment node
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguagesProvider } from "@/components/LanguagesProvider";
import { allLangs, langName, registerLanguages } from "@/lib/lang";

const japanese = { code: "jaJP", name: "Japanese", native: "日本語", bcp47: "ja-JP", provider: "ja", client: false };

function Name({ code }: { code: string }) {
  return createElement("span", null, langName(code));
}

describe("LanguagesProvider", () => {
  afterEach(() => {
    registerLanguages([]);
    vi.unstubAllGlobals();
  });

  it("in the browser, lets a child rendered in the same pass name a language beyond the built-in ones", () => {
    vi.stubGlobal("window", {});
    expect(langName("jaJP")).toBe("jaJP");
    const html = renderToString(createElement(LanguagesProvider, { languages: [japanese], children: createElement(Name, { code: "jaJP" }) }));
    expect(html).toContain("Japanese");
    expect(allLangs()).toContain("jaJP");
  });

  it("leaves the server's registry to loadLanguages", () => {
    renderToString(createElement(LanguagesProvider, { languages: [japanese], children: null }));
    expect(allLangs()).not.toContain("jaJP");
  });
});
