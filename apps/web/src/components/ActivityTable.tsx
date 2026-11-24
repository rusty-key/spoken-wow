"use client";

/**
 * A language's activity log: who did what, when, with the audio playable where there is any.
 *
 * Every filter lives in the URL, like /reports, so a narrowed log can be shared and the back
 * button undoes a filter. Paging is an Older link carrying a keyset cursor rather than page
 * numbers; see listActivity for why.
 */
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import AudioPlayer from "@/components/AudioPlayer";
import DateChip from "@/components/DateChip";
import FilterChip from "@/components/FilterChip";
import { useLang } from "@/components/LangProvider";
import { useUiText } from "@/components/UiTextProvider";
import { Refreshing } from "@/components/Loading";
import Link from "@/components/LocaleLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePendingPush } from "@/components/usePendingPush";
import { useLocalDates } from "@/components/useLocalDates";
import { CATEGORIES, categoryOf, FOLDS, type Category, type Group } from "@/lib/activity/kinds";
import type { ActivityRow } from "@/lib/activity/store";
import { usd } from "@/lib/generation/money";
import { isProvider, PROVIDER_NAME } from "@/lib/generation/providers";
import { localeHref, withLang } from "@/lib/lang";
import { explorerHref, lexiconHref } from "@/lib/links";
import { capabilityLabel, isCapability } from "@/lib/permissions";
import { SOURCE_LABELS } from "@/lib/reports/reports";
import { fill as fillFrom } from "@/lib/site-text/format";
import type { UiText } from "@/lib/ui-text/en";
import { SOURCES, type Source } from "@/lib/sections";
import { cn } from "@/lib/utils";

type Filter = {
  category?: Category;
  actorId?: string;
  source?: Source;
  from?: string;
  to?: string;
};


/** One take the transport bar can be pointed at. */
type Take = { source: Source; file: string; version: number };

const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
const DAY: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" };

/** A capability the way /admin names it, or the raw string when a later release wrote one. */
function grantName(value: unknown): string | null {
  return isCapability(value) ? capabilityLabel(value) : str(value);
}

/** A logged list of capabilities, as the table names them. */
function grantNames(value: unknown): string {
  return (Array.isArray(value) ? value : []).map(grantName).join(", ");
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** A body a row names, "gnome woman". */
function bodyWords(d: Record<string, unknown>): string {
  return [str(d.race), num(d.sex) === 3 ? "woman" : "man"].join(" ");
}

/** An NPC an activity names, by name or else by kind and id. */
function speakerName(d: Record<string, unknown>, anNpc: string): string {
  const id = num(d.npcId);
  return str(d.npcName) ?? (id === null ? anNpc : `${str(d.npcType) ?? "NPC"} ${id}`);
}

/** "a → b", or whichever half is known: rows backfilled from older tables carry neither. */
function change(before: string | null, after: string | null): string | null {
  if (before && after) return `${before} → ${after}`;
  return after ?? before;
}

/**
 * What one row says happened, in words, plus the text it quotes. The quoted part is kept
 * apart so the row can clamp it without clamping the verb.
 *
 * Every sentence comes from the dictionary, so a kind the log writes reads in the reader's
 * own language. Where English branched inside a sentence, the branches are separate keys:
 * a sentence cut into pieces does not translate.
 */
export function describe(row: ActivityRow, t: UiText["activity"]["events"]): { what: string; quote: string | null } {
  const d = row.detail;
  // A count or version the log did not carry reads as "?": a 0 would state something false.
  const version = num(d.version) ?? "?";
  const fill = fillFrom;
  switch (row.kind) {
    case "take.generated": {
      const cost =
        num(d.costUsd) !== null
          ? usd(num(d.costUsd)!)
          : num(d.credits) !== null
            ? fill(t.credits, { n: num(d.credits)!.toLocaleString() })
            : null;
      const provider = isProvider(d.provider) ? fill(t.takeGeneratedProvider, { provider: PROVIDER_NAME[d.provider] }) : "";
      return { what: fill(t.takeGenerated, { version, provider }), quote: cost };
    }
    case "take.restored":
      return {
        what: num(d.from)
          ? fill(t.takeRestoredOver, { version, from: num(d.from)! })
          : fill(t.takeRestored, { version }),
        quote: null,
      };
    case "take.encode_failed":
      return { what: fill(t.takeEncodeFailed, { version }), quote: str(d.error) };
    case "recording.uploaded":
      return { what: fill(t.recordingUploaded, { version }), quote: null };
    case "recording.removed":
      return { what: fill(t.recordingRemoved, { version }), quote: null };
    case "take.acked":
      return { what: t.takeAcked, quote: row.lineId ? null : row.subject };
    case "marks.cleared": {
      const count = num(d.count);
      return { what: count === 1 ? t.marksClearedOne : fill(t.marksClearedMany, { n: count ?? "?" }), quote: null };
    }
    case "batch.queued": {
      const count = num(d.count);
      return {
        what: count === 1 ? t.batchQueuedOne : fill(t.batchQueuedMany, { n: count ?? "?" }),
        quote: str(d.label),
      };
    }
    case "batch.stopped": {
      const cancelled = num(d.cancelled);
      return {
        what:
          !cancelled
            ? t.batchStopped
            : cancelled === 1
              ? t.batchStoppedCancellingOne
              : fill(t.batchStoppedCancellingMany, { n: cancelled }),
        quote: str(d.reason) ?? str(d.label),
      };
    }
    case "queue.stopped": {
      const batches = num(d.batches);
      const cancelled = num(d.cancelled);
      return {
        what: fill(cancelled === 1 ? t.queueStoppedOne : t.queueStoppedMany, {
          m: batches === 1 ? t.oneBatch : fill(t.manyBatches, { n: batches ?? "?" }),
          n: cancelled ?? "?",
        }),
        quote: str(d.reason),
      };
    }
    case "queue.paused":
      return { what: t.queuePaused, quote: null };
    case "queue.resumed":
      return { what: t.queueResumed, quote: null };
    case "text.edited":
      if (num(d.contribution)) {
        return { what: fill(t.tookCorrection, { id: num(d.contribution)! }), quote: str(d.text) };
      }
      return {
        what: version ? fill(t.textEditedVersion, { version }) : t.textEdited,
        quote: str(d.text),
      };
    case "text.restored":
      return { what: fill(t.textRestored, { version }), quote: null };
    case "text.retired":
      return { what: fill(t.textRetired, { version }), quote: null };
    case "text.player_words":
      return {
        what: d.after ? t.playerWordsChanged : t.playerWordsRemoved,
        quote: str(d.after),
      };
    case "name.edited":
      return { what: t.nameEdited, quote: str(d.name) };
    case "name.restored":
      return { what: fill(t.nameRestored, { version }), quote: null };
    case "name.retired":
      return { what: fill(t.nameRetired, { version }), quote: null };
    case "name.observed":
      return { what: t.nameObserved, quote: str(d.name) };
    case "lexicon.added":
      return { what: fill(t.lexiconAdded, { subject: row.subject ?? "" }), quote: str(d.after) };
    case "lexicon.edited":
      return {
        what: fill(t.lexiconEdited, { subject: row.subject ?? "" }),
        quote: change(str(d.before), str(d.after)),
      };
    case "lexicon.removed":
      return { what: fill(t.lexiconRemoved, { subject: row.subject ?? "" }), quote: str(d.before) };
    case "override.set":
      if (num(d.contribution)) {
        return { what: fill(t.tookCorrection, { id: num(d.contribution)! }), quote: str(d.text) };
      }
      return { what: t.overrideSet, quote: str(d.text) };
    case "override.cleared":
      return { what: t.overrideCleared, quote: str(d.before) };
    case "ignore.set":
      return { what: row.lang === null ? t.ignoreSetEvery : t.ignoreSet, quote: str(d.reason) };
    case "ignore.cleared":
      return { what: t.ignoreCleared, quote: null };
    case "setting.changed":
      return {
        what: str(d.setting) === "raceTags" ? t.settingRaceTags : t.settingGeneration,
        quote: null,
      };
    case "voice.cloned":
      return {
        what: num(d.sampleCount)
          ? fill(t.voiceClonedSamples, { subject: row.subject ?? "", n: num(d.sampleCount)! })
          : fill(t.voiceCloned, { subject: row.subject ?? "" }),
        quote: null,
      };
    case "voice.adopted":
      return {
        what: str(d.from)
          ? fill(t.voiceAdoptedFrom, { subject: row.subject ?? "", from: str(d.from)! })
          : fill(t.voiceAdopted, { subject: row.subject ?? "" }),
        quote: null,
      };
    case "reference.set":
      return { what: fill(t.referenceSet, { subject: row.subject ?? "" }), quote: str(d.transcript) };
    case "reference.edited":
      return { what: fill(t.referenceEdited, { subject: row.subject ?? "" }), quote: str(d.transcript) };
    case "reference.deleted":
      return { what: fill(t.referenceDeleted, { subject: row.subject ?? "" }), quote: null };
    case "reference.pinned":
      return { what: fill(t.referencePinned, { subject: row.subject ?? "" }), quote: null };
    case "reference.unpinned":
      return { what: fill(t.referenceUnpinned, { subject: row.subject ?? "" }), quote: null };
    case "sample.added":
    case "sample.deleted":
    case "sample.imported":
    case "sample.merged": {
      const files = Array.isArray(d.files) ? (d.files as string[]) : [];
      const verb = row.kind.split(".")[1];
      const one = files.length === 1;
      const subject = row.subject ?? "";
      const key =
        verb === "added"
          ? one
            ? t.sampleAddedOne
            : t.sampleAddedMany
          : verb === "deleted"
            ? one
              ? t.sampleDeletedOne
              : t.sampleDeletedMany
            : verb === "imported"
              ? one
                ? t.sampleImportedOne
                : t.sampleImportedMany
              : one
                ? t.sampleMergedOne
                : t.sampleMergedMany;
      return { what: fill(key, { subject, n: files.length }), quote: files.join(", ") || null };
    }
    case "npc.split":
      return d.race
        ? { what: fill(t.npcSplitBody, { name: str(d.npcName) ?? row.subject ?? "" }), quote: bodyWords(d) }
        : { what: fill(t.npcSplit, { name: str(d.npcName) ?? row.subject ?? "" }), quote: null };
    case "npc.unsplit":
      return d.race
        ? { what: fill(t.npcUnsplitBody, { name: str(d.npcName) ?? row.subject ?? "" }), quote: bodyWords(d) }
        : { what: fill(t.npcUnsplit, { name: str(d.npcName) ?? row.subject ?? "" }), quote: null };
    case "npc.speaker_added":
      return {
        what: fill(t.npcSpeakerAdded, { speaker: speakerName(d, t.anNode), subject: row.subject ?? "" }),
        quote: null,
      };
    case "npc.speaker_removed":
      return {
        what: fill(t.npcSpeakerRemoved, { speaker: speakerName(d, t.anNode), subject: row.subject ?? "" }),
        quote: null,
      };
    case "npc.speaker_replaced":
      return {
        what: fill(t.npcSpeakerReplaced, {
          speaker: speakerName(d, t.anNode),
          from: speakerName((d.from ?? {}) as Record<string, unknown>, t.anNode),
          subject: row.subject ?? "",
        }),
        quote: null,
      };
    case "npc.direction":
      return d.direction
        ? { what: fill(t.npcDirectionSet, { name: str(d.npcName) ?? row.subject ?? "" }), quote: str(d.direction) }
        : { what: fill(t.npcDirectionCleared, { name: str(d.npcName) ?? row.subject ?? "" }), quote: null };
    case "npc.resolved": {
      const name = str(d.npcName) ?? row.subject ?? "";
      return {
        what:
          num(d.sex) === 3
            ? fill(t.npcResolvedWoman, { name })
            : num(d.sex) === 2
              ? fill(t.npcResolvedMan, { name })
              : fill(t.npcResolved, { name }),
        quote: [str(d.race), str(d.gender), str(d.flavor)].filter(Boolean).join(" · ") || null,
      };
    }
    case "type.changed":
      return {
        what: fill(t.typeChanged, {
          action: str(d.action)?.replace("-", " ") ?? t.typeChangedDefaultAction,
          subject: row.subject ?? "",
        }),
        quote: [str(d.gender), str(d.flavor), str(d.voice)].filter(Boolean).join(" · ") || null,
      };
    case "grant.added":
      return {
        what: fill(t.grantAdded, {
          name: row.subjectName ?? t.someone,
          capability: grantName(d.capability) ?? "",
        }),
        quote: null,
      };
    case "grant.removed":
      return {
        what: fill(t.grantRemoved, {
          capability: grantName(d.capability) ?? "",
          name: row.subjectName ?? t.someone,
        }),
        quote: null,
      };
    case "invite.sent":
      return {
        what: fill(t.inviteSent, {
          email: str(d.email) ?? t.someone,
          capabilities: grantNames(d.capabilities),
        }),
        quote: null,
      };
    case "invite.resent":
      return { what: fill(t.inviteResent, { email: str(d.email) ?? t.someone }), quote: null };
    case "invite.accepted":
      return { what: fill(t.inviteAccepted, { capabilities: grantNames(d.capabilities) }), quote: null };
    case "invite.revoked":
      return { what: fill(t.inviteRevoked, { email: str(d.email) ?? t.someone }), quote: null };
    case "language.toggled":
      return { what: d.enabled ? t.languageOn : t.languageOff, quote: null };
    case "language.added":
      return { what: fill(t.languageAdded, { name: str(d.name) ?? "" }).trim(), quote: null };
    case "team.created":
      return { what: fill(t.teamCreated, { slug: str(d.slug) ?? "" }).trim(), quote: null };
    case "team.deleted": {
      const members = Array.isArray(d.members) ? d.members : [];
      const slug = str(d.slug) ?? t.unknown;
      return {
        what: members.length
          ? fill(members.length === 1 ? t.teamDeletedMembersOne : t.teamDeletedMembersMany, {
              slug,
              n: members.length,
            })
          : fill(t.teamDeleted, { slug }),
        quote: null,
      };
    }
    case "team.renamed":
      return { what: t.teamRenamed, quote: str(d.name) };
    case "team.own_storage":
      return {
        what: d.ownStorage
          ? fill(t.teamOwnStorage, { team: row.subject ?? "" })
          : fill(t.teamSiteStorage, { team: row.subject ?? "" }),
        quote: null,
      };
    case "team.official":
      return {
        what: d.official
          ? fill(t.teamOfficial, { team: row.subject ?? "" })
          : fill(t.teamUnofficial, { team: row.subject ?? "" }),
        quote: null,
      };
    case "team.language_moved":
      return {
        what: fill(t.teamLanguageMoved, { from: str(d.from) ?? t.unknown, to: str(d.to) ?? t.unknown }),
        quote: null,
      };
    case "team.second_in_language":
      return {
        what: fill(d.settings === "copy" ? t.teamSecondInLanguageCopy : t.teamSecondInLanguage, {
          slug: str(d.slug) ?? t.unknown,
          beside: str(d.beside) ?? t.unknown,
        }),
        quote: null,
      };
    case "team.joined_language":
      return {
        what: str(d.from)
          ? fill(t.teamJoinedLanguageFrom, { slug: str(d.slug) ?? t.unknown, from: str(d.from)! })
          : fill(t.teamJoinedLanguage, { slug: str(d.slug) ?? t.unknown }),
        quote: null,
      };
    case "release.started":
      return {
        what: fill(t.releaseStarted, { section: str(d.section) ?? t.aSection }),
        quote: null,
      };
    case "release.finished": {
      const section = str(d.section) ?? t.aSection;
      const key =
        d.state === "failed"
          ? t.releaseFailed
          : d.state === "unchanged"
            ? t.releaseUnchanged
            : d.state === "awaiting_review"
              ? t.releaseAwaiting
              : t.releaseFinished;
      return { what: fill(key, { section }), quote: str(d.version) };
    }
    case "release.approved":
      return {
        what: fill(t.releaseApproved, { section: str(d.section) ?? t.aSection }),
        quote: str(d.version),
      };
    case "release.rejected":
      return {
        what: join(fill(t.releaseRejected, { section: str(d.section) ?? t.aSection }), str(d.version)),
        quote: str(d.reason),
      };
    case "release.delisted":
      return {
        what: fill(t.releaseDelisted, { section: str(d.section) ?? t.aSection }),
        quote: null,
      };
    case "pack.submitted":
      return { what: join(fill(t.packSubmitted, { pack: row.subject ?? "" }), str(d.version)), quote: null };
    case "pack.approved":
      return { what: join(fill(t.packApproved, { pack: row.subject ?? "" }), str(d.version)), quote: null };
    case "pack.rejected":
      return {
        what: join(fill(t.packRejected, { pack: row.subject ?? "" }), str(d.version)),
        quote: str(d.reason),
      };
    case "pack.withdrawn":
      return { what: join(fill(t.packWithdrawn, { pack: row.subject ?? "" }), str(d.version)), quote: null };
    case "pack.listed":
      return { what: fill(t.packListed, { pack: row.subject ?? "" }), quote: null };
    case "pack.unlisted":
      return { what: fill(t.packUnlisted, { pack: row.subject ?? "" }), quote: null };
    case "pack.owner":
      return {
        what: d.ownerId
          ? fill(t.packOwnerHanded, { pack: row.subject ?? "" })
          : fill(t.packOwnerLeft, { pack: row.subject ?? "" }),
        quote: null,
      };
    case "request.made":
      return {
        what: fill(t.requestMade, { lang: str(d.lang) ?? t.aLanguage }),
        quote: str(d.teamName),
      };
    case "request.withdrawn":
      return { what: fill(t.requestWithdrawn, { lang: str(d.lang) ?? t.aLanguage }), quote: null };
    case "request.approved":
      return {
        what: fill(t.requestApproved, { lang: str(d.lang) ?? t.aLanguage }),
        quote: str(d.slug),
      };
    case "request.rejected":
      return {
        what: fill(t.requestRejected, { lang: str(d.lang) ?? t.aLanguage }),
        quote: str(d.reason),
      };
    case "contribution.resolved":
      return {
        what: fill(
          d.correction ? t.contributionResolvedCorrection : t.contributionResolved,
          { status: str(d.status) ?? t.resolved },
        ).trim(),
        quote: str(d.key),
      };
    case "contribution.edited":
      return {
        what: fill(t.contributionEdited, { field: str(d.field) ?? t.details }),
        quote: null,
      };
    case "report.resolved":
      return {
        what: fill(t.reportResolved, { status: str(d.status) ?? t.resolved }),
        quote: str(d.category),
      };
    case "report.passed":
      return { what: d.to === "text" ? t.reportPassedText : t.reportPassedTeam, quote: null };
    case "user.role_changed":
      return {
        what: fill(t.userRole, {
          name: row.subjectName ?? t.aRemovedUser,
          role: str(d.role) ?? t.unknown,
        }),
        quote: null,
      };
    case "user.banned":
      return {
        what: fill(t.userBanned, { name: row.subjectName ?? t.aRemovedUser }),
        quote: str(d.banReason),
      };
    case "user.unbanned":
      return { what: fill(t.userUnbanned, { name: row.subjectName ?? t.aRemovedUser }), quote: null };
    case "user.removed":
      return { what: t.userRemoved, quote: null };
    case "user.impersonated":
      return {
        what: fill(t.userImpersonated, { name: row.subjectName ?? t.aRemovedUser }),
        quote: null,
      };
    // A kind this page does not know: one a newer release wrote before a rollback to this
    // one. Shown by its name rather than breaking the page.
    default:
      return { what: String(row.kind), quote: null };
  }
}

/** Two parts of one sentence, with the second left out when there is none. */
function join(head: string, tail: string | null): string {
  return tail ? `${head} ${tail}` : head;
}

/** Where a row points, if anywhere: the line, the page that manages the thing, or nothing. */
function target(
  row: ActivityRow,
  t: UiText["activity"]["events"]["links"],
): { href: string; label: string } | null {
  if (row.source && row.lineId) return { href: explorerHref(row.source, row.lineId), label: row.lineId };
  if (categoryOf(row.kind) === "voices") {
    return row.subject ? { href: "/voices", label: row.subject } : null;
  }
  if (row.kind.startsWith("lexicon.") && row.subject) {
    return { href: lexiconHref(row.subject), label: t.pronunciation };
  }
  if (row.kind.startsWith("grant.") || row.kind.startsWith("invite.") || row.kind.startsWith("user.")) {
    return { href: "/admin", label: t.users };
  }
  if (row.kind.startsWith("report.")) {
    return { href: "/reports?view=all", label: fillFrom(t.report, { id: row.subject ?? "" }) };
  }
  if (row.kind.startsWith("pack.")) return { href: "/admin/packs", label: t.packs };
  if (row.kind.startsWith("request.")) return { href: "/admin/teams", label: t.requests };
  if (row.kind.startsWith("contribution.")) {
    return { href: "/contributions", label: fillFrom(t.contribution, { id: row.subject ?? "" }) };
  }
  return null;
}

const FOLD_OF = new Map(
  (Object.entries(FOLDS) as [Group, (typeof FOLDS)[Group]][]).map(([kind, fold]) => [fold.parent as string, { kind, ...fold }]),
);

/**
 * The rows a row opens onto, if it folds any (FOLDS). For a batch, `count` is what the
 * server counted for the page's day range.
 */
function groupOf(row: ActivityRow): { kind: Group; id: string; count: number } | null {
  const fold = FOLD_OF.get(row.kind);
  const id = fold && str(row.detail[fold.key]);
  if (!fold || !id) return null;
  const count = fold.count === null ? row.takes : num(row.detail[fold.count]);
  return { kind: fold.kind, id, count: count ?? 0 };
}

/** "1 line" or "3 lines", where the words are the reader's. */
function pluralText(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** The takes a row lets you hear: the new one, and for a restore the one it replaced. */
function takesOf(row: ActivityRow): Take[] {
  if (!row.source || !row.subject) return [];
  const version = num(row.detail.version);
  if (version === null) return [];
  const take = (v: number): Take => ({ source: row.source!, file: row.subject!, version: v });
  if (row.kind === "take.generated") return [take(version)];
  if (row.kind === "take.restored") {
    const from = num(row.detail.from);
    return from ? [take(version), take(from)] : [take(version)];
  }
  return [];
}

/** A play button for one take, sized for a row or for a batch's list. */
function PlayTake({ take, onPlay, compact }: { take: Take; onPlay: (take: Take) => void; compact?: boolean }) {
  const t = useUiText().activity;
  return (
    <Button
      size="sm"
      variant="ghost"
      className={compact ? "ml-auto h-6 px-2" : "h-7 px-2"}
      title={fillFrom(t.playVersion, { version: take.version })}
      onClick={() => onPlay(take)}
    >
      <Play className={compact ? "size-3" : "size-3.5"} /> v{take.version}
    </Button>
  );
}

export default function ActivityTable({
  rows,
  next,
  paged,
  filter,
  actors,
}: {
  rows: ActivityRow[];
  /** The cursor for the Older link, or null on the last page. */
  next: string | null;
  /** Whether this is a page after the first, which earns a link back to the newest. */
  paged: boolean;
  filter: Filter;
  actors: { id: string; name: string }[];
}) {
  const text = useUiText();
  const t = text.activity;
  const categoryOptions = CATEGORIES.map((category) => ({ value: category, label: t.categories[category] }));
  const sourceOptions = SOURCES.map((source) => ({ value: source, label: t.sections[source] }));
  const date = useLocalDates();
  const lang = useLang();
  const { pending, push } = usePendingPush();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<Take | null>(null);
  // Bumped on every press so pressing the same take twice replays it; see ReportTable.
  const [pressed, setPressed] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const loading = useRef(new Set<string>());
  // Keyed by group and day range: the same batch lists different takes under another range.
  const [groups, setGroups] = useState<Record<string, ActivityRow[] | "failed">>({});
  const rangeKey = `${filter.from ?? ""}:${filter.to ?? ""}`;

  useEffect(() => {
    if (pressed === 0) return;
    void audio.current?.play().catch(() => {});
  }, [pressed]);

  function play(take: Take) {
    setPlaying(take);
    setPressed((count) => count + 1);
  }

  /** Move one filter, keep the rest, and start again from the newest row. */
  function go(change: Partial<Record<keyof Filter, string | undefined>>) {
    const merged = { ...filter, ...change };
    const params = new URLSearchParams();
    if (merged.category) params.set("category", merged.category);
    if (merged.actorId) params.set("actor", merged.actorId);
    if (merged.source) params.set("source", merged.source);
    if (merged.from) params.set("from", merged.from);
    if (merged.to) params.set("to", merged.to);
    push(localeHref(lang, `/activity${params.size ? `?${params}` : ""}`));
  }

  function older() {
    if (!next) return;
    const params = new URLSearchParams(window.location.search);
    params.set("before", next);
    push(localeHref(lang, `/activity?${params}`));
  }

  function newest() {
    const params = new URLSearchParams(window.location.search);
    params.delete("before");
    push(localeHref(lang, `/activity${params.size ? `?${params}` : ""}`));
  }

  const keyOf = (group: { kind: Group; id: string }) => `${group.kind}:${group.id}:${rangeKey}`;

  async function toggleGroup(row: ActivityRow) {
    const group = groupOf(row);
    if (!group) return;
    const key = keyOf(group);
    const opening = open !== row.id;
    setOpen(opening ? row.id : null);
    // A failed load is tried again on the next open; one still in flight is not.
    if (!opening || Array.isArray(groups[key]) || loading.current.has(key)) return;
    loading.current.add(key);
    const params = new URLSearchParams({ id: group.id, kind: group.kind });
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    const response = await fetch(withLang(lang, `/api/activity/batch?${params}`)).catch(() => null);
    const takes = response?.ok ? ((await response.json()) as { takes: ActivityRow[] }).takes : null;
    loading.current.delete(key);
    setGroups((current) => ({ ...current, [key]: takes ?? "failed" }));
  }

  // Day headings between rows, so a column of bare clock times can be read.
  let lastDay: string | null = null;

  return (
    <>
      <nav className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip
          label={t.what}
          value={filter.category}
          options={categoryOptions}
          onChange={(value) => go({ category: value })}
        />
        <FilterChip
          label={t.who}
          value={filter.actorId}
          options={actors.map((actor) => ({ value: actor.id, label: actor.name }))}
          onChange={(value) => go({ actorId: value })}
        />
        <FilterChip
          label={t.section}
          value={filter.source}
          options={sourceOptions}
          onChange={(value) => go({ source: value })}
        />
        <DateChip label={t.from} value={filter.from} onChange={(value) => go({ from: value })} />
        <DateChip label={t.to} value={filter.to} onChange={(value) => go({ to: value })} />
        {pending && <Refreshing />}
      </nav>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.nothingYet}</p>
      ) : (
        <table
          aria-busy={pending}
          className={cn(
            "w-full border-separate border-spacing-0 text-sm transition-opacity",
            pending && "opacity-60",
          )}
        >
          <tbody>
            {rows.flatMap((row) => {
              const heading = date(row.at, DAY);
              const out = [];
              if (heading !== lastDay) {
                lastDay = heading;
                out.push(
                  <tr key={`day-${row.id}`}>
                    <th
                      colSpan={4}
                      className="text-muted-foreground border-b pt-5 pb-1 text-left text-xs font-medium"
                    >
                      {heading}
                    </th>
                  </tr>,
                );
              }

              const { what, quote } = describe(row, t.events);
              const link = target(row, t.events.links);
              const takes = takesOf(row);
              const group = groupOf(row);
              const expanded = group !== null && open === row.id;

              out.push(
                <tr key={row.id} className="align-top [&>td]:border-b [&>td]:py-2 [&>td]:leading-5">
                  <td className="text-muted-foreground w-14 pr-3 text-xs whitespace-nowrap tabular-nums">
                    {date(row.at, TIME)}
                  </td>
                  <td className="w-40 max-w-[10rem] truncate pr-3 font-medium">
                    {row.actorName ?? <span className="text-muted-foreground font-normal">{t.system}</span>}
                  </td>
                  <td className="pr-3">
                    <div className="flex flex-wrap items-center gap-x-2">
                      {row.lang === null && (
                        <Badge variant="outline" className="py-0 leading-5">
                          {t.allLanguages}
                        </Badge>
                      )}
                      <span>{what}</span>
                      {link && (
                        <Link
                          href={link.href}
                          title={link.label}
                          className="text-muted-foreground max-w-[18rem] truncate font-mono text-xs underline-offset-2 hover:underline"
                        >
                          {link.label}
                        </Link>
                      )}
                    </div>
                    {quote && (
                      <p className="text-muted-foreground line-clamp-2 text-xs" title={quote}>
                        {quote}
                      </p>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {takes.map((take) => (
                      <PlayTake key={take.version} take={take} onPlay={play} />
                    ))}
                    {group && group.count > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        aria-expanded={expanded}
                        onClick={() => void toggleGroup(row)}
                      >
                        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        {pluralText(group.count, t.nouns.one[group.kind], t.nouns.many[group.kind])}
                      </Button>
                    )}
                  </td>
                </tr>,
              );

              if (expanded && group) {
                const inner = groups[keyOf(group)];
                out.push(
                  <tr key={`${row.id}-takes`}>
                    <td />
                    <td colSpan={3} className="border-b pb-2">
                      {inner === undefined ? (
                        <p className="text-muted-foreground py-2 text-xs">{fillFrom(t.loadingGroup, { what: t.nouns.many[group.kind] })}</p>
                      ) : inner === "failed" ? (
                        <p className="text-destructive py-2 text-xs">{fillFrom(t.groupFailed, { what: t.nouns.many[group.kind] })}</p>
                      ) : (
                        <ul className="max-h-80 overflow-y-auto text-xs">
                          {inner.map((take) => (
                            <li key={take.id} className="flex items-center gap-2 py-0.5">
                              <span className="text-muted-foreground w-12 tabular-nums">{date(take.at, TIME)}</span>
                              {take.kind === "batch.stopped" ? (
                                <span className="truncate">
                                  {str(take.detail.label) ?? t.aBatch}
                                  {num(take.detail.cancelled) !== null && (
                                    <span className="text-muted-foreground">
                                      {" "}
                                      · {fillFrom(t.cancelled, { n: pluralText(num(take.detail.cancelled)!, t.nouns.lineOne, t.nouns.lineMany) })}
                                    </span>
                                  )}
                                </span>
                              ) : take.source && take.lineId ? (
                                <Link
                                  href={explorerHref(take.source, take.lineId)}
                                  className="truncate font-mono underline-offset-2 hover:underline"
                                >
                                  {take.lineId}
                                </Link>
                              ) : (
                                <span className="truncate font-mono">{take.subject}</span>
                              )}
                              {takesOf(take).map((one) => (
                                <PlayTake key={one.version} take={one} onPlay={play} compact />
                              ))}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>,
                );
              }
              return out;
            })}
          </tbody>
        </table>
      )}

      {(paged || next) && (
        <div className="flex items-center justify-center gap-3 py-4">
          {paged && (
            <Button size="sm" variant="secondary" onClick={newest}>
              {t.newest}
            </Button>
          )}
          {next && (
            <Button size="sm" variant="secondary" onClick={older}>
              {t.older}
            </Button>
          )}
        </div>
      )}

      {/* Drawn once something has been played, like /reports: an idle bar over a log is
          chrome that answers nothing. The archived take is served by /api/takes/audio,
          which a language admin passes because admin includes regenerate. */}
      {playing && (
        <div className="fixed inset-x-0 bottom-0 z-40">
          <AudioPlayer
            audioRef={audio}
            src={withLang(
              lang,
              `/api/takes/audio?${new URLSearchParams({
                source: playing.source,
                file: playing.file,
                version: String(playing.version),
              })}`,
            )}
            title={playing.file}
            meta={`v${playing.version}`}
            downloadName={`${playing.file.split("/").pop()?.replace(/\.mp3$/, "")}-v${playing.version}.mp3`}
          />
        </div>
      )}
    </>
  );
}
