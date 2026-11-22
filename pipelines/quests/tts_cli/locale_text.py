"""What an NPC's gossip reads as on a client in another language.

The addon finds a gossip line from the NPC's text as the client shows it, then plays the
file named for that line's hash. The hash is the English text's in every language, so the
file is found in any pack. The *text* is the part that changes with the client: an English
table cannot match a Spanish client's words, and nine gossip lines in ten belong to an NPC
with more than one, so a guess by word overlap across two languages is mostly wrong.

So a language's Gossip pack carries that language's text beside its English tables, and
nothing else does: the table is only any use on a client in that locale, and a player on one
who wants to hear the language installs its pack. export-locale-text writes the file from
Postgres, which holds `localeText` -- the line as the world database, and so the client,
has it -- for every line imported from there. build reads it and writes guarded tables that
load only on a client in that locale (see build.locale_tables).

The same file carries the language's current NPC, object and item names, which the pack ships
the same way: the quest log names a giver who is no longer on screen, and only the database
knows what to call them.

Nothing here needs a database: this reads and writes the file, and corpus_db does the query.
"""
from tts_cli.corpus import load_corpus, write_corpus


def write_locale_text(path: str, lang: str, lines: list, names=()) -> str:
    """Write one language's rows, [{lineId, originalText, localeText}, ...], and its names,
    [{kind, entityId, name}, ...].

    In the corpus's own envelope, so an unchanged export is an identical file.
    """
    write_corpus(path, {"lang": lang, "lines": lines, "names": list(names)})
    return path


def load_locale_text(path: str):
    """(lang, rows) from a file write_locale_text wrote."""
    document = load_corpus(path)
    return document["lang"], document["lines"]


def load_locale_names(path: str) -> list:
    """The names a file write_locale_text wrote carries; none in a file written before them."""
    return load_corpus(path).get("names", [])
