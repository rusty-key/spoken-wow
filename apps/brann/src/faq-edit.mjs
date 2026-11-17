// The FAQ as entries, and the edits the weekly sweep proposes to it. Pure, tested in
// faq-edit.test.mjs.

/** The FAQ split into its preamble and its `## ` entries, each {heading, body}. */
export function parseFaq(text) {
  const parts = text.split(/^## /m);
  const preamble = parts.shift();
  const entries = parts.map((part) => {
    const newline = part.indexOf("\n");
    return { heading: part.slice(0, newline).trim(), body: part.slice(newline + 1).trim() };
  });
  return { preamble: preamble.trimEnd(), entries };
}

export function renderFaq({ preamble, entries }) {
  return `${[preamble, ...entries.map((e) => `## ${e.heading}\n\n${e.body.trim()}`)].join("\n\n")}\n`;
}

/**
 * Applies the sweep's changes, each {action: add|edit|remove, heading, new_heading, after, body}.
 * Returns the new FAQ and the changes that could not apply (an edit of a heading that is not
 * there, an add of one that is), which the PR lists instead of guessing.
 */
export function applyChanges(text, changes) {
  const faq = parseFaq(text);
  const applied = [];
  const skipped = [];
  const at = (heading) => faq.entries.findIndex((e) => e.heading === heading);
  for (const change of changes) {
    const i = at(change.heading);
    if (change.action === "add") {
      if (i >= 0 || !change.body.trim()) {
        skipped.push({ change, why: i >= 0 ? "an entry with that heading exists" : "no text" });
        continue;
      }
      const after = change.after ? at(change.after) : -1;
      const entry = { heading: change.heading, body: change.body };
      if (after >= 0) faq.entries.splice(after + 1, 0, entry);
      else faq.entries.push(entry);
    } else if (i < 0) {
      skipped.push({ change, why: "no entry has that heading" });
      continue;
    } else if (change.action === "remove") {
      faq.entries.splice(i, 1);
    } else if (change.action === "edit") {
      if (!change.body.trim()) {
        skipped.push({ change, why: "no text" });
        continue;
      }
      const heading = change.new_heading?.trim() || change.heading;
      if (heading !== change.heading && at(heading) >= 0) {
        skipped.push({ change, why: "another entry has the new heading" });
        continue;
      }
      faq.entries[i] = { heading, body: change.body };
    } else {
      skipped.push({ change, why: `unknown action ${change.action}` });
      continue;
    }
    applied.push(change);
  }
  return { text: renderFaq(faq), applied, skipped };
}

/** Evidence references made links: `m12` is a Discord message, a commit hash a commit. */
export function evidenceLinks(refs, { messages, repo }) {
  return refs
    .map((ref) => {
      if (messages.has(ref)) return `[${ref}](${messages.get(ref)})`;
      if (/^[0-9a-f]{7,40}$/.test(ref)) return `[${ref.slice(0, 7)}](https://github.com/${repo}/commit/${ref})`;
      return null;
    })
    .filter(Boolean);
}

const VERB = { add: "Add", edit: "Edit", remove: "Remove" };

/**
 * The PR's description. It is public, so it holds no player's words or name: each change says why,
 * and links the Discord messages behind it, which only the server's members can open.
 */
export function prBody({ applied, skipped, problems, days, links, footer }) {
  const lines = [
    `The weekly FAQ sweep read the last ${days} days of the Discord and of the code, and proposes these changes to \`docs/support/FAQ.md\`, the only thing Brann answers from.`,
    "",
    "Check each against its evidence before merging: Brann tells players exactly what this file says.",
    "",
  ];
  if (problems.length) {
    lines.push("> [!WARNING]", "> The FAQ check fails on the result. CI does not run on this PR, so fix these first:");
    for (const p of problems) lines.push(`> - ${p}`);
    lines.push("");
  }
  for (const change of applied) {
    const name = change.action === "edit" && change.new_heading && change.new_heading !== change.heading
      ? `${change.heading} → ${change.new_heading}` : change.heading;
    lines.push(`### ${VERB[change.action]}: ${name}`, "", change.reason);
    const evidence = links(change.evidence);
    if (evidence.length) lines.push("", `Evidence: ${evidence.join(", ")}`);
    lines.push("");
  }
  if (skipped.length) {
    lines.push("### Not applied", "");
    for (const { change, why } of skipped) lines.push(`- ${VERB[change.action] ?? change.action} "${change.heading}": ${why}. ${change.reason}`);
    lines.push("");
  }
  lines.push(footer);
  return `${lines.join("\n")}\n`;
}
