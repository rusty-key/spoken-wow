/**
 * Resolving a contribution -- the route's whole verb, now that accepting a quests row can also
 * write a line.
 *
 * Everything except quests-accept is the plain status flip setContributionStatus always did:
 * books and zones already have their own path from a contribution to a corpus entry
 * (existing.ts), and a moderator moving any row to "new" or "rejected" changes nothing else.
 * Quests-accept is different because the accepted line must appear in the explorer, and the
 * explorer reads the quest tables (lib/quests/catalogue.ts) -- so accepting writes into them:
 * a `quest_line` row with origin "contributed" and a `quest_line_speaker` row carrying the
 * contribution's id, in the same transaction as the status update. Re-accepting must not
 * duplicate, and a status flip with no line, or a line with no status flip, is a state nothing
 * else here is built to handle.
 *
 * The speaker row is what marks a line as contributed, not the line's origin: an editor's text
 * fix adds an "edited" version on top, and the line is still one a player sent. It is also what
 * the importer (tts_cli/corpus_db.py) leaves alone when it replaces every extracted speaker.
 *
 * The contributed text is what the player's client displayed, with that player's name, class
 * and race put back as `$N`, `$C` and `$R` by the addon -- the only side that knows which words
 * they were. So it is a template, like the extract's: stored as `originalText`, with `text` its
 * spoken form (tokens.ts). Anything else the client substituted -- the one branch of a `$G` it
 * picked -- stays as displayed; an editor has the text-override flow for that.
 */
import { skipReasonFor } from "@/lib/text-gate";
import type { PoolClient } from "pg";

import { normaliseText } from "@books-tools/lib/text.mjs";

import { recordActivity } from "@/lib/activity/store";
import { db } from "@/lib/db";
import { observedFrom } from "@/lib/npc/resolve";
import { getResolution, getResolutionsById, type NpcKind } from "@/lib/npc/store";
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import { corpus } from "@/lib/quests/catalogue";
import { isVoice } from "@/lib/voices/voices";

import type { ContributionStatus } from "./contributions";
import { answersQuestMoment, lineIdentityFor, voiceNameFor, type LineIdentity } from "./naming";
import { CONTRIBUTION_COLUMNS, observationMeta, type Contribution } from "./store";
import { spokenFromTemplate } from "./tokens";
import { idOnlyResolution } from "./triage";

const COLUMNS = CONTRIBUTION_COLUMNS;

/**
 * Where contributed speakers start in quest_line_speaker's `ord`. The importer numbers the
 * extract's own rows from 0 on every import, so contributed rows sit far above it: they never
 * collide with a re-import, and the export lists them after everything the extract carries.
 */
const CONTRIBUTED_ORD_FLOOR = 1_000_000;

export type ResolveRefusal =
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "needs-speaker"; message: string }
  | { ok: false; reason: "one-way"; message: string }
  | { ok: false; reason: "malformed"; message: string };

export type ResolveOutcome = { ok: true; contribution: Contribution } | ResolveRefusal;

type Speaker = {
  npcId: number;
  npcName: string | null;
  npcType: NpcKind;
  race: string;
  gender: string;
  flavor: string | null;
};

/** What accept writes: a new line and its speaker, or only a speaker on a line already there. */
type Prepared =
  | { kind: "exists" }
  | { kind: "speaker"; lineId: string; variant: number; speaker: Speaker }
  | { kind: "line"; identity: LineIdentity; text: string; speaker: Speaker };

/** Who speaks a quests contribution, from npc_resolution -- the same lookup triage.ts's page renders from. */
async function resolvedSpeaker(
  meta: Record<string, string>,
): Promise<Speaker | "conflict" | null> {
  const observed = observedFrom(meta);
  if (observed.npcId === null) return null;

  let resolution;
  if (observed.npcKind) {
    resolution = await getResolution(observed.npcKind, observed.npcId);
  } else {
    const lookup = idOnlyResolution((await getResolutionsById([observed.npcId])).get(observed.npcId));
    if (lookup.conflict.length) return "conflict";
    resolution = lookup.resolution;
  }

  if (!resolution?.race || !resolution?.gender) return null;

  return {
    npcId: observed.npcId,
    npcName: resolution.npcName ?? observed.npcName,
    npcType: resolution.npcKind,
    race: resolution.race,
    gender: resolution.gender,
    flavor: resolution.flavor,
  };
}

/**
 * What accepting a quests contribution writes, or a refusal.
 *
 * The tables are the corpus, so "is this line already there" is asked of them:
 *
 *   - A quest line is matched by quest id and moment alone (answersQuestMoment): the tables
 *     carry some moments only as `:m`/`:f` player-gender variants, and a contribution names a
 *     moment and nothing finer. Already there means nothing is written -- the corpus wins, and
 *     a second contribution for the same moment is the same line.
 *   - A gossip line is one text spoken by many NPCs. Already there (by id, or by text once the
 *     corpus's own trailing whitespace is normalised away) means this NPC is added as one more
 *     speaker of it, unless they already are one.
 */
async function prepareLine(contribution: Contribution): Promise<{ ok: true; prepared: Prepared } | ResolveRefusal> {
  const speaker = await resolvedSpeaker(observationMeta(contribution));
  if (speaker === "conflict") {
    return {
      ok: false,
      reason: "needs-speaker",
      message: "This NPC's id has conflicting answers -- pick which one it is first.",
    };
  }
  if (!speaker) {
    return {
      ok: false,
      reason: "needs-speaker",
      message: "Set the speaker first -- a line needs a voice.",
    };
  }
  // The roster is what /voices, the filters and the triage selects offer, so a line in a voice
  // outside it -- a client guess naming a race nobody has added -- would be unvoiceable and
  // unfindable. Adding the voice to voices.ts is the fix, not accepting the line anyway.
  const voice = voiceNameFor(speaker.race, speaker.gender, speaker.flavor);
  if (!isVoice(voice)) {
    return {
      ok: false,
      reason: "needs-speaker",
      message: `${voice} isn't a voice yet -- pick another speaker, or add it to voices.ts.`,
    };
  }

  const { quest, event } = contribution.meta;
  const isGossip = !(quest && event);

  const identity = lineIdentityFor(contribution.meta, contribution.text, speaker.race, speaker.gender);
  if (!identity) {
    return {
      ok: false,
      reason: "malformed",
      message: isGossip ? "gossip contribution has no text to hash" : `unknown quest event "${event}"`,
    };
  }
  if (!contribution.text) {
    return { ok: false, reason: "malformed", message: "contribution has no text to voice" };
  }

  const lines = (await corpus()).lines;

  if (!isGossip) {
    const exists = lines.some((l) => answersQuestMoment(l.lineId, identity.lineId));
    return { ok: true, prepared: exists ? { kind: "exists" } : { kind: "line", identity, text: contribution.text, speaker } };
  }

  // By id, or by text: 1,644 of the corpus's gossip lines carry trailing whitespace in
  // `originalText` that normaliseText (already applied to contribution.text at intake,
  // submission.ts) strips, so a verbatim duplicate of one of them hashes differently.
  const text = contribution.text;
  const match = lines.find(
    (l) =>
      l.source === "gossip" &&
      (l.lineId === identity.lineId ||
        (l.race === speaker.race && l.gender === speaker.gender && normaliseText(l.originalText) === text)),
  );
  if (!match) return { ok: true, prepared: { kind: "line", identity, text, speaker } };

  const speaks = lines.some(
    (l) => l.lineId === match.lineId && l.npcType === speaker.npcType && l.npcId === speaker.npcId,
  );
  if (speaks) return { ok: true, prepared: { kind: "exists" } };
  return { ok: true, prepared: { kind: "speaker", lineId: match.lineId, variant: 0, speaker } };
}

/** Whether a contribution already has a speaker row in the quest tables -- i.e. has been written. */
export async function contributedSpeakerExists(contributionId: number, client?: PoolClient): Promise<boolean> {
  const { rowCount } = await (client ?? db()).query(
    `select 1 from "quest_line_speaker" where "contributionId" = $1`,
    [contributionId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Whether an accepted quests contribution's line is already in the explorer, one way or
 * another: its own speaker row was written, or the tables already had the line (and, for
 * gossip, this NPC speaking it) before it was accepted. What decides whether "Add to explorer"
 * still belongs on a row -- answered the same way accept itself would, so pressing the button
 * is never a silent no-op. A row whose speaker is unresolved answers false: pressing it lands on
 * "Set the speaker first".
 */
export async function lineIsInExplorer(contribution: Contribution): Promise<boolean> {
  if (contribution.source !== "quests" || contribution.status !== "accepted") return false;
  if (await contributedSpeakerExists(contribution.id)) return true;
  const result = await prepareLine(contribution);
  return result.ok && result.prepared.kind === "exists";
}

async function insertSpeaker(
  client: PoolClient,
  contributionId: number,
  lineId: string,
  variant: number,
  speaker: Speaker,
): Promise<void> {
  // One writer at a time past this point, so two accepts can never pick the same `ord`.
  await client.query(`select pg_advisory_xact_lock(hashtext('quest_line_speaker.contributed_ord'))`);
  await client.query(
    `insert into "quest_line_speaker"
       ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender",
        "flavor", "voice", "contributionId")
     select $1, $2, $3,
            greatest(coalesce(max("ord") + 1, 0), $4),
            $5, $6, $7, $8, $9, $10, $11, $12
       from "quest_line_speaker" where "lang" = $3`,
    [
      lineId, variant, BASE_LANG, CONTRIBUTED_ORD_FLOOR, speaker.npcType, speaker.npcId,
      speaker.npcName ?? `npc ${speaker.npcId}`, speaker.race, speaker.gender, speaker.flavor,
      voiceNameFor(speaker.race, speaker.gender, speaker.flavor), contributionId,
    ],
  );
}

async function insertLine(
  client: PoolClient,
  contributionId: number,
  userId: string,
  identity: LineIdentity,
  template: string,
): Promise<void> {
  await client.query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
        "questTitle", "playerGender", "fileName", "text", "originalText", "generatable",
        "skipReason", "editedBy", "note")
     values ($1, 0, $2, 1, true, 'contributed', $3, $4, $5, null, $6, $7, $8, $9, $10, $11, $12)`,
    [
      identity.lineId, BASE_LANG, identity.source, identity.questId, identity.questTitle,
      identity.fileName, spokenFromTemplate(template), template, true, null,
      userId, `contribution #${contributionId}`,
    ],
  );
}

/**
 * A contribution sent from a pack in another language: the translation of a quest line the
 * English corpus already has, written as that language's version of it.
 *
 * Only a quest line can be matched. Its id is the quest and the moment, the same in every
 * language; a gossip line's id is a hash of its English text, which a Portuguese client never
 * shows, so there is nothing to match it to. And only a line English has: a translation is
 * of something, and a line nobody has sent in English is contributed in English first.
 *
 * The text keeps its $N, $C and $R. The English accept writes "adventurer" in their place,
 * which in another language is an English word, so here they stay in, as the dump's own
 * translations keep theirs, and the language's own word is put in when the line is voiced
 * (player-words.ts).
 * A line this language already has is left alone: an import or a translator got there first.
 */
async function acceptTranslation(
  client: PoolClient,
  contribution: Contribution,
  userId: string,
): Promise<ResolveRefusal | null> {
  const { quest, event } = contribution.meta;
  if (!(quest && event)) {
    return {
      ok: false,
      reason: "malformed",
      message: "A greeting in another language cannot be matched to the English line it translates.",
    };
  }
  const identity = lineIdentityFor(contribution.meta, contribution.text ?? "", "", "");
  if (!identity || !contribution.text) {
    return { ok: false, reason: "malformed", message: `unknown quest event "${event}"` };
  }

  const english = (await corpus()).lines.filter((line) =>
    answersQuestMoment(line.lineId, identity.lineId),
  );
  if (english.length === 0) {
    return {
      ok: false,
      reason: "needs-speaker",
      message: "The English line is not in the corpus yet -- it has to be contributed in English first.",
    };
  }

  const text = contribution.text;
  const seen = new Set<string>();
  for (const line of english) {
    const key = `${line.lineId}#${line.variant ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Per variant: its $N is spoken in the form the variant's player gender takes.
    const skipReason = skipReasonFor(text, contribution.locale as Lang, line.playerGender);
    await client.query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
          "questTitle", "playerGender", "fileName", "text", "originalText", "localeText",
          "generatable", "skipReason", "editedBy", "note")
       select e."lineId", e."variant", $3, 1, true, 'contributed', e."source", e."questId",
              null, e."playerGender", e."fileName", $4, e."originalText", $4, $5, $6, $7, $8
         from "quest_line" e
        where e."lineId" = $1 and e."variant" = $2 and e."lang" = $9 and e."isCurrent"
          and not exists (select 1 from "quest_line" t
                           where t."lineId" = $1 and t."variant" = $2 and t."lang" = $3)`,
      [
        line.lineId, line.variant ?? 0, contribution.locale, text, skipReason === null,
        skipReason, userId, `contribution #${contribution.id}`, BASE_LANG,
      ],
    );
  }
  return null;
}

/**
 * Change a contribution's status, writing its line into the quest tables first when the target
 * is "accepted" for a fresh quests row.
 */
export async function resolveContribution(
  id: number,
  status: ContributionStatus,
  userId: string,
): Promise<ResolveOutcome> {
  const client = await db().connect();
  // Set only on the path below where rollback itself throws -- that is the one case that
  // releases the client itself (with the error, so node-postgres destroys rather than recycles
  // a connection left in an unknown state) instead of leaving it to the normal `finally`.
  let released = false;
  try {
    await client.query("begin");

    const { rows } = await client.query<Contribution>(
      `select ${COLUMNS} from "contribution" where "id" = $1 for update`,
      [id],
    );
    const contribution = rows[0];
    if (!contribution) {
      await client.query("rollback");
      return { ok: false, reason: "not-found" };
    }
    // Intake stores only the site's languages; a row from before it did must not write text
    // under a language no page shows.
    if (status === "accepted" && !isLang(contribution.locale)) {
      await client.query("rollback");
      return {
        ok: false,
        reason: "malformed",
        message: `sent from a ${contribution.locale} client, which is not a language here`,
      };
    }

    const written = await contributedSpeakerExists(id, client);

    // One-way once written. Audio may already have been generated for the line, and the
    // explorer's own line-ignore is how an editor backs out of a line they no longer want.
    if (written && status !== "accepted") {
      await client.query("rollback");
      return {
        ok: false,
        reason: "one-way",
        message: "This line is already in the explorer; ignore it there instead.",
      };
    }

    if (
      status === "accepted" &&
      contribution.source === "quests" &&
      contribution.locale !== BASE_LANG
    ) {
      const refused = await acceptTranslation(client, contribution, userId);
      if (refused) {
        await client.query("rollback");
        return refused;
      }
    } else if (status === "accepted" && contribution.source === "quests" && !written) {
      const result = await prepareLine(contribution);
      if (!result.ok) {
        await client.query("rollback");
        return result;
      }
      const { prepared } = result;
      if (prepared.kind === "line") {
        // Checked again inside the transaction: a concurrent accept of another contribution for
        // the same line may have written it since prepareLine read the catalogue. Whichever
        // lands first wins; this one is then only accepted.
        const { rowCount: taken } = await client.query(
          `select 1 from "quest_line" where "lang" = $1 and ("lineId" = $2 or "lineId" like $2 || ':%')`,
          [BASE_LANG, prepared.identity.lineId],
        );
        if (!taken) {
          await insertLine(client, id, userId, prepared.identity, prepared.text);
          await insertSpeaker(client, id, prepared.identity.lineId, 0, prepared.speaker);
        }
      } else if (prepared.kind === "speaker") {
        await insertSpeaker(client, id, prepared.lineId, prepared.variant, prepared.speaker);
      }
    }

    const updated = await client.query<Contribution>(
      `update "contribution"
          set "status" = $2, "resolvedBy" = $3, "updatedAt" = now()
        where "id" = $1
        returning ${COLUMNS}`,
      [id, status, userId],
    );
    // In the transaction, so a resolve that rolls back is never logged. A row sent from a
    // client in a language the site does not have is logged under every language rather
    // than dropped: somebody still resolved it.
    await recordActivity(
      {
        kind: "contribution.resolved",
        lang: isLang(contribution.locale) ? contribution.locale : null,
        source: contribution.source,
        subject: String(id),
        actorId: userId,
        detail: { status, key: contribution.key },
      },
      client,
    );

    await client.query("commit");
    return { ok: true, contribution: updated.rows[0] };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      // The rollback itself failed, so the client's state is unknown and must not go back to
      // the pool for reuse -- release(err) is what tells node-postgres to destroy it instead
      // of recycling it. Rethrowing `error`, not `rollbackError`: the caller's diagnosis
      // belongs to whatever actually went wrong, not to the rollback's own failure to undo it.
      released = true;
      client.release(rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
      throw error;
    }
    throw error;
  } finally {
    if (!released) client.release();
  }
}
