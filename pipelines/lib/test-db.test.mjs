import assert from "node:assert/strict";
import { test } from "node:test";

import { seedDatabase } from "./test-db.mjs";

const db = seedDatabase();

// psql prints a statement's status line, `INSERT 0 0`, among the rows unless told not to, and
// language() would read it as the code it asked for: taken as its own, the code another run made
// would be deleted by this run's cleanup.
test("an insert that conflicts returns no rows", { skip: !db && "needs DATABASE_URL" }, (t) => {
  t.after(() => db.cleanup());
  const code = db.language();
  const rows = db.sql(`insert into "language" ("code", "name", "native", "bcp47", "provider", "client")
                       values (${db.lit(code)}, 'Xq', 'Xq', 'xq-XQ', 'xq', false)
                       on conflict do nothing returning "code"`);
  assert.deepEqual(rows, []);
});
