// Needs DATABASE_URL naming a migrated test database, as a superuser who may create databases:
// the sync runs between two scratch databases made with its schema. Skipped without one.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "sync-section.sh");
const url = process.env.DATABASE_URL;
const skip = url ? false : "DATABASE_URL is not set";
const tag = randomUUID().slice(0, 8);
const names = { up: `sync_up_${tag}`, down: `sync_down_${tag}` };
const urlOf = (name) => {
  const at = new URL(url);
  at.pathname = `/${name}`;
  return at.toString();
};
const psql = (db, sql) =>
  execFileSync("psql", [db, "-qtAX", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8" }).trim();

// Teams of the same slug have different ids in each database, as production and a laptop do. No
// team voices xqBB here.
// One team besides stimmen has the plain packs of xqAA in each.
const teams = (plain) => `
  insert into "team" ("slug", "name") values ('english', 'English'), ('stimmen', 'Stimmen'), ('${plain}', 'Plain');
  insert into "team_language" ("teamId", "lang", "packName")
    select "id", case "slug" when 'english' then 'enUS' else 'xqAA' end,
           case "slug" when 'stimmen' then 'slug' else 'plain' end from "team";`;

before(() => {
  if (!url) return;
  const schema = execFileSync("pg_dump", ["--schema-only", "--no-owner", url], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (const name of Object.values(names)) {
    psql(url, `create database "${name}"`);
    execFileSync("psql", [urlOf(name), "-qX", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: schema, stdio: ["pipe", "ignore", "pipe"] });
  }
  // Upstream gone has the plain packs, a team this machine lacks.
  psql(urlOf(names.up), `${teams("gone")}
    insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
      select 'places', case t."slug" when 'english' then 'enUS' else 'xqAA' end, t."slug" || '.mp3', t."slug", 1, true,
             'generated', 1, t."id" from "team" t
      union all select 'places', 'xqBB', 'nobody.mp3', 'nobody', 1, true, 'generated', 1, "id" from "team" where "slug" = 'stimmen';
    insert into "line_ignore" ("lineId", "reason", "lang", "teamId")
      select 'team-' || "slug", 'x', 'xqAA', "id" from "team" where "slug" <> 'english'
      union all select 'language', 'x', 'xqAA', null
      union all select 'everywhere', 'x', null, null;`);
  psql(urlOf(names.down), teams("lokal"));
});

after(() => {
  if (!url) return;
  for (const name of Object.values(names)) psql(url, `drop database if exists "${name}" with (force)`);
});

test("a synced row goes to the local team of its slug, else the one with plain packs, and a language's own ignore keeps no team", { skip }, () => {
  execFileSync("bash", [SCRIPT, "places", "lore_line", "line_ignore"], {
    input: "y\n",
    env: { ...process.env, SOURCE_DB: urlOf(names.up), LOCAL_DB: urlOf(names.down) },
    stdio: ["pipe", "ignore", "pipe"],
  });
  const down = urlOf(names.down);
  const rows = (sql) => psql(down, sql).split("\n").filter(Boolean);
  assert.deepEqual(rows(`select k."lineId" || ' ' || t."slug" from "take" k join "team" t on t."id" = k."teamId" order by 1`), [
    "english english",
    "gone lokal",
    "nobody english",
    "stimmen stimmen",
  ]);
  assert.deepEqual(
    rows(`select i."lineId" || ' ' || coalesce(i."lang", '-') || ' ' || coalesce(t."slug", '-')
            from "line_ignore" i left join "team" t on t."id" = i."teamId" order by 1`),
    ["everywhere - -", "language xqAA -", "team-gone xqAA lokal", "team-stimmen xqAA stimmen"],
  );
});
