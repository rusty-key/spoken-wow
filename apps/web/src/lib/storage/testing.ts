/** For tests: a team bucket row whose store is an in-memory one, removed with every object naming it. */
import { afterAll } from "vitest";

import { memoryBlobs } from "@/lib/blobs/store";
import { useBackendForTests } from "@/lib/blobs/where";
import { asSystem } from "@/lib/teams/testing";

const made: string[] = [];

afterAll(async () => {
  if (made.length === 0) return;
  await asSystem.query(`delete from "archive_object" where "backendId" = any($1::uuid[])`, [made]);
  await asSystem.query(`delete from "storage_backend" where "id" = any($1::uuid[])`, [made]);
});

export async function testBackend({
  team,
  publicUrl = "https://team.test/",
  writing = false,
  health = "ok",
}: { team?: string; publicUrl?: string | null; writing?: boolean; health?: "unchecked" | "ok" | "failing" } = {}) {
  const teamId =
    team ?? (await asSystem.query<{ id: string }>(`select "id" from "team" where "slug" = 'english'`)).rows[0].id;
  const { rows } = await asSystem.query<{ id: string }>(
    `insert into "storage_backend"
       ("teamId", "label", "provider", "endpoint", "bucket", "publicUrl", "accessKeyId", "secretSealed", "writing", "health")
     values ($1, 'test', 'other', 'https://s3.test', 'team-bucket', $2, 'key', 'v1:unused', $3, $4)
     returning "id"`,
    [teamId, publicUrl, writing, health],
  );
  const id = rows[0].id;
  made.push(id);
  const store = memoryBlobs({ publicUrl });
  const restore = useBackendForTests(id, store);
  return { id, teamId, store, restore };
}

export async function placeObject(key: string, backendId: string, { pending = false, missing = false } = {}) {
  const [prefix, sha256] = key.split("/");
  await asSystem.query(
    `insert into "archive_object" ("prefix", "sha256", "backendId", "teamId", "pending", "missingAt")
     values ($1, $2, $3, (select "teamId" from "storage_backend" where "id" = $3), $4, case when $5 then now() end)`,
    [prefix, sha256, backendId, pending, missing],
  );
}
