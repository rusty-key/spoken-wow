#!/usr/bin/env python3
"""Block-balance check for the addon's Lua files.

    python3 tools/lua-syntax-check.py

There is no Lua interpreter in this environment, and a missing `end` costs a
relog to discover in game, so this catches the common structural errors without
one. It is NOT a parser -- it lexes far enough to know what is code and what is
not, then balances block keywords and delimiters.

Doing this with regexes does not work: lore prose contains " -- " (em dashes are
normalised to that), so stripping comments before strings eats a closing quote,
while stripping strings first breaks on an apostrophe in a code comment. Both
orderings report bogus imbalances, hence the character-by-character lexer.
"""

import glob
import sys

# `do` covers for/while bodies, so `for` and `while` are not counted themselves.
OPENERS = {"function", "if", "do", "repeat"}
CLOSERS = {"end", "until"}


def code_only(src):
    """Return src with comments and string literals replaced by spaces."""
    out = []
    i, n = 0, len(src)

    def long_bracket(j):
        """If src[j:] opens a long bracket [[ or [=*[, return its level."""
        if src[j] != "[":
            return None
        k = j + 1
        eq = 0
        while k < n and src[k] == "=":
            eq += 1
            k += 1
        if k < n and src[k] == "[":
            return eq
        return None

    while i < n:
        ch = src[i]

        # long comment --[[ ]] or line comment --
        if ch == "-" and i + 1 < n and src[i + 1] == "-":
            level = long_bracket(i + 2) if i + 2 < n else None
            if level is not None:
                close = "]" + "=" * level + "]"
                end = src.find(close, i + 2)
                i = n if end < 0 else end + len(close)
            else:
                end = src.find("\n", i)
                i = n if end < 0 else end
            out.append(" ")
            continue

        # long string [[ ]]
        level = long_bracket(i)
        if level is not None:
            close = "]" + "=" * level + "]"
            end = src.find(close, i)
            i = n if end < 0 else end + len(close)
            out.append(" ")
            continue

        # short string
        if ch in "\"'":
            quote = ch
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                if src[i] == "\n":  # unterminated; let the balance check flag it
                    break
                i += 1
            out.append(" ")
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def words(src):
    token = []
    for ch in src:
        if ch.isalnum() or ch == "_":
            token.append(ch)
        else:
            if token:
                yield "".join(token)
                token = []
    if token:
        yield "".join(token)


def check(path):
    src = code_only(open(path, encoding="utf-8").read())
    problems = []

    depth = lowest = 0
    for tok in words(src):
        if tok in OPENERS:
            depth += 1
        elif tok in CLOSERS:
            depth -= 1
            lowest = min(lowest, depth)
    if depth != 0:
        problems.append(f"block depth ends at {depth:+d} (unclosed block or stray end)")
    if lowest < 0:
        problems.append(f"block depth went negative ({lowest}) -- an extra end/until")

    for open_ch, close_ch, label in (("(", ")", "paren"), ("{", "}", "brace"), ("[", "]", "bracket")):
        delta = src.count(open_ch) - src.count(close_ch)
        if delta != 0:
            problems.append(f"unbalanced {label} {delta:+d}")

    return problems


def main():
    failed = False
    # Relative to the repo root, which is where make/places.mk runs it from. A glob that
    # matches nothing exits 0, so a stale path here reads as a clean check forever.
    paths = sorted(glob.glob("addons/Spoken_Places/**/*.lua", recursive=True))
    if not paths:
        sys.exit("lua-syntax-check: matched no files -- run me from the repo root")
    for path in paths:
        problems = check(path)
        if problems:
            failed = True
            print(f"FAIL  {path}")
            for p in problems:
                print(f"        {p}")
        else:
            print(f"ok    {path}")
    if failed:
        print("\nNote: this is a structural check, not a parser. It cannot catch")
        print("typos, bad field names, or runtime errors -- only in-game can.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
