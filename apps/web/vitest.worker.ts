/**
 * Points this worker at its own clone (vitest.databases.ts) before any test module opens a
 * pool, so two workers never share a table.
 */
import { workerUrl } from "./vitest.databases";

const base = process.env.SPOKEN_TEST_BASE_URL;
if (base) {
  const worker = Number(process.env.VITEST_POOL_ID);
  const workers = Number(process.env.SPOKEN_TEST_WORKERS);
  if (!(worker >= 1 && worker <= workers)) {
    throw new Error(`worker ${process.env.VITEST_POOL_ID} has no database: ${workers} were cloned`);
  }
  process.env.DATABASE_URL = workerUrl(base, worker);
}
