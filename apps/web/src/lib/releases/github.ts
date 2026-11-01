/**
 * The site's side of the release workflow: start it, and find it again by the name the site
 * gave it. The token never reaches a message or a log; errors carry GitHub's own words only.
 */
import "server-only";

const WORKFLOW = "release-packs.yaml";
const TIMEOUT_MS = 15_000;

export type GithubRun = {
  id: number;
  url: string;
  status: string;
  conclusion: string | null;
  step: string | null;
};

type Fetch = typeof fetch;

/** No token or no repository configured: not a GitHub failure, and not worth a retry. */
export class GithubNotConfiguredError extends Error {
  constructor() {
    super("releases need SPOKEN_RELEASE_GITHUB_TOKEN and SPOKEN_RELEASE_GITHUB_REPO set");
  }
}

export class GithubError extends Error {
  constructor(readonly status: number, message: string) {
    super(`GitHub answered ${status}: ${message}`);
  }
}

function config(): { token: string; repo: string; ref: string } {
  const token = process.env.SPOKEN_RELEASE_GITHUB_TOKEN;
  const repo = process.env.SPOKEN_RELEASE_GITHUB_REPO;
  if (!token || !repo) throw new GithubNotConfiguredError();
  return { token, repo, ref: process.env.SPOKEN_RELEASE_GITHUB_REF || "master" };
}

async function call(fetchFn: Fetch, path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const { token, repo } = config();
  const response = await fetchFn(`https://api.github.com/repos/${repo}/${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    // A hung GitHub must not hold a request open, or leave the press stuck in dispatching.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new GithubError(response.status, detail?.message ?? response.statusText);
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

export async function dispatchRelease(
  run: { id: string; section: string; lang: string },
  fetchFn: Fetch = fetch,
): Promise<void> {
  const { ref } = config();
  await call(fetchFn, `actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: {
      ref,
      inputs: {
        section: run.section,
        locale: run.lang,
        manager_only: "true",
        dry_run: "false",
        release_id: run.id,
      },
    },
  });
}

type WorkflowRun = { id: number; html_url: string; status: string; conclusion: string | null; display_title: string };
type Job = { steps?: { name: string; number: number; status: string }[] };

async function currentStep(fetchFn: Fetch, runId: number): Promise<string | null> {
  const body = (await call(fetchFn, `actions/runs/${runId}/jobs`)) as { jobs?: Job[] } | null;
  for (const job of body?.jobs ?? []) {
    const steps = job.steps ?? [];
    const step = steps.find((s) => s.status === "in_progress");
    if (step) return `${step.name}, step ${step.number} of ${steps.length}`;
  }
  return null;
}

export async function findRun(releaseId: string, fetchFn: Fetch = fetch): Promise<GithubRun | null> {
  const body = (await call(fetchFn, `actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=50`)) as
    { workflow_runs?: WorkflowRun[] } | null;
  const found = body?.workflow_runs?.find((r) => r.display_title === `release ${releaseId}`);
  if (!found) return null;
  // One request while polling, except for a build that is actually under way.
  const step = found.status === "in_progress" ? await currentStep(fetchFn, found.id) : null;
  return { id: found.id, url: found.html_url, status: found.status, conclusion: found.conclusion, step };
}
