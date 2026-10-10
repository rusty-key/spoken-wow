#!/usr/bin/env python3
"""Read the Spoken Developer debug log out of the game's saved variables.

For an AI agent (or a person) on the player's computer: when the player says a line did not
play, ask them to right-click a Report or Contribute button > Write the Debug Log for an AI Agent
(or /spoken log write), run this, and read the `diag` block written then (how things stood: the
window and quest open, Read Automatically, the queue), then the `quests` and `player` lines around
the quest (what happened, and why).

    python scripts/developer/read-log.py                    # the last diag block, then the last 300 lines
    python scripts/developer/read-log.py --tail 100
    python scripts/developer/read-log.py --since "Kobold Camp Cleanup"   # from the last line naming it
    python scripts/developer/read-log.py --grep "quests|player"
    python scripts/developer/read-log.py --file path/to/Spoken_Developer.lua

The game writes saved variables only at a reload, logout or exit, and no addon can make it write
them otherwise: Write takes the snapshot and reloads the interface for that. A log read without
one ends at the last of those. The file is evaluated with lupa (pip install lupa), the Lua the tests run on,
so it is read exactly as the game would read it back. Logs other players' clients sent through
Spoken Party Sync (SpokenPartySync.lua, `collected`) are merged in on this client's clock, as far
as they fall within this log's time: a collection from an earlier session is left out.
"""
import argparse
import glob
import os
import re
import sys
import time

DEFAULT_WTF = r"D:\BattleNetLibrary\World of Warcraft\_classic_beta_\WTF\Account"
DIAG_HEAD = re.compile(r"^diag [^ ].*:$")
WRITTEN = "written for an AI agent"
WRITE_HOW = ("right-click a Report or Contribute button > Write the Debug Log for an AI Agent, "
             "or /spoken log write")


def lua_runtime():
    try:
        from lupa import lua51
        return lua51.LuaRuntime(unpack_returned_tuples=True)
    except ImportError:
        try:
            import lupa
            return lupa.LuaRuntime(unpack_returned_tuples=True)
        except ImportError:
            sys.exit("lupa is needed to read the saved variables: pip install lupa")


def find_file(wtf):
    """The newest Spoken_Developer.lua under any account's SavedVariables."""
    found = glob.glob(os.path.join(wtf, "*", "SavedVariables", "Spoken_Developer.lua"))
    if not found:
        sys.exit("no Spoken_Developer.lua under %s\\<account>\\SavedVariables: is the module installed, "
                 "and has the game saved since (a /reload)?" % wtf)
    return max(found, key=os.path.getmtime)


def evaluate(lua, path, name):
    with open(path, encoding="utf-8", errors="replace") as handle:
        lua.execute(handle.read())
    return lua.globals()[name]


def array(table):
    if table is None:
        return []
    return [table[i] for i in range(1, len(table) + 1)]


def parse(lines, who, offset=0.0):
    rows = []
    for n, line in enumerate(lines):
        match = re.match(r"^(-?[\d.]+) (.*)$", str(line))
        if match:
            rows.append((float(match.group(1)) + offset, who, match.group(2), n))
    return rows


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--file", help="Spoken_Developer.lua to read (default: found under --wtf)")
    parser.add_argument("--wtf", default=DEFAULT_WTF, help="the client's WTF\\Account folder")
    parser.add_argument("--tail", type=int, default=300, help="how many of the newest lines (0: all)")
    parser.add_argument("--since", help="start at the last line containing this text")
    parser.add_argument("--grep", help="only lines matching this regular expression")
    parser.add_argument("--max-age", type=float, default=30, help="minutes after which the file is called stale")
    parser.add_argument("--no-diag", action="store_true", help="leave out the last diag block")
    args = parser.parse_args()

    path = args.file or find_file(args.wtf)
    lua = lua_runtime()
    db = evaluate(lua, path, "SpokenDeveloperDB")
    if db is None:
        sys.exit("%s holds no SpokenDeveloperDB" % path)
    own = array(db["lines"])
    on = bool(db["on"])

    names = [m.group(1) for m in (re.search(r"^[\d.]+ session [^:]+: (.+?), Spoken ", str(l)) for l in own) if m]
    me = names[-1] if names else "this client"
    rows = parse(own, me)

    # A collection is kept until the next one, so it may be from another session (another
    # character, an earlier day): only its lines within this log's time belong next to it.
    span = (min(row[0] for row in rows) - 60, max(row[0] for row in rows) + 60) if rows else None
    party = os.path.join(os.path.dirname(path), "SpokenPartySync.lua")
    others, skipped = 0, 0
    if os.path.exists(party):
        try:
            sync = evaluate(lua_runtime(), party, "SpokenPartySyncDB")
            collected = sync and sync["collected"]
            if collected:
                for _, log in collected.items():
                    theirs = parse(array(log["lines"]), str(log["name"] or "?"), float(log["offset"] or 0))
                    within = [row for row in theirs if span and span[0] <= row[0] <= span[1]]
                    if within:
                        rows += within
                        others += 1
                    elif theirs:
                        skipped += 1
        except Exception as error:  # a party log that does not read is not this script's failure
            print("(could not read %s: %s)" % (party, error), file=sys.stderr)
    rows.sort(key=lambda row: (row[0], row[1] != me, row[3]))

    age = (time.time() - os.path.getmtime(path)) / 60
    print("Spoken debug log: %s (%.0f KB)" % (path, os.path.getsize(path) / 1024))
    print("  file written %.0f min ago%s; the log is %s; %d lines%s" % (
        age, " (stale: ask the player to %s)" % WRITE_HOW if age > args.max_age else "",
        "on" if on else "OFF (nothing new is kept: Spoken > Developer > Enable Debug Log Recording)",
        len(own), (", with %d other player's log(s)" % others) if others else ""))
    marks = [m.group(1) for m in (re.search(r"^[\d.]+ session %s at (.+)$" % WRITTEN, str(l)) for l in own) if m]
    if marks:
        print("  last written for an AI agent at %s: its diagnostics are below" % marks[-1])
    else:
        print("  never written for an AI agent: for the state of a moment, ask the player to %s" % WRITE_HOW)
    if skipped:
        print("  (%d party log(s) in SpokenPartySync.lua are from another session: left out)" % skipped)

    if not args.no_diag:
        # The block of the newest Write: the moment the player asked about, rather than a login
        # snapshot taken after the reload. The newest block of any kind without one.
        start, written = None, None
        for i in range(len(own) - 1, -1, -1):
            text = str(own[i]).split(" ", 1)[1] if " " in str(own[i]) else ""
            if DIAG_HEAD.match(text):
                if start is None:
                    start = i
                if text == "diag %s:" % WRITTEN:
                    written = i
                    break
        if written is not None:
            start = written
        if start is not None:
            print()
            print("== the last diagnostics ==")
            for line in own[start:]:
                text = str(line).split(" ", 1)[1]
                if not text.startswith("diag "):
                    break
                print(text[5:])

    if args.since:
        index = None
        for i in range(len(rows) - 1, -1, -1):
            if args.since in rows[i][2]:
                index = i
                break
        if index is None:
            print("\n(no line contains %r)" % args.since)
            return
        rows = rows[index:]
    if args.grep:
        pattern = re.compile(args.grep)
        rows = [row for row in rows if pattern.search(row[2])]
    if args.tail and len(rows) > args.tail:
        rows = rows[-args.tail:]

    print()
    print("== the log, %d lines, oldest first ==" % len(rows))
    for t, who, text, _ in rows:
        print("%10.3f  %-16s %s" % (t, who, text))


if __name__ == "__main__":
    main()
