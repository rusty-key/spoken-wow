"""Read localized quest wording from a Classic Era ``questcache.wdb`` file.

Classic clients cache the server response for every quest the player has seen.  Unlike a world
database dump, that response is the authoritative wording for the exact client locale, including
the description and conclusion shown in the quest window.
"""

from __future__ import annotations

import struct
from pathlib import Path

STRING_FIELDS = [
    ("title", 9), ("logDescription", 12), ("questDescription", 12), ("areaDescription", 9),
    ("portraitGiverText", 10), ("portraitGiverName", 8), ("portraitTurnInText", 10),
    ("portraitTurnInName", 8), ("completionLog", 11),
]
HEADER_LEN = 12
OBJECTIVE_FIXED = 43
OBJECTIVE_EFFECTS = 33
OBJECTIVE_DESCRIPTION_LENGTH = 41
MAX_OBJECTIVES = 12


def read_wdb(path: Path) -> tuple[bytes, int, str, dict[int, bytes]]:
    data = path.read_bytes()
    if len(data) < 24 or data[:4] != b"TSQW":
        raise ValueError(f"{path}: not a Classic quest cache")
    build = struct.unpack_from("<I", data, 4)[0]
    locale = data[8:12][::-1].decode("ascii", "replace")
    records: dict[int, bytes] = {}
    pos = 24
    while pos + 8 <= len(data):
        quest_id, length = struct.unpack_from("<II", data, pos)
        if length == 0 or pos + 8 + length > len(data):
            break
        records[quest_id] = data[pos + 8:pos + 8 + length]
        pos += 8 + length
    return data[:4], build, locale, records


def _lengths(record: bytes, pos: int) -> list[int]:
    value = int.from_bytes(record[pos:pos + HEADER_LEN], "big")
    shift, lengths = HEADER_LEN * 8, []
    for _, width in STRING_FIELDS:
        shift -= width
        lengths.append((value >> shift) & ((1 << width) - 1))
    return lengths


def _objective_chain(record: bytes, header: int) -> list[int] | None:
    best = None
    for start in range(header - OBJECTIVE_FIXED,
                       max(-1, header - MAX_OBJECTIVES * (OBJECTIVE_FIXED + 255)), -1):
        pos, amounts, ids = start, [], []
        while pos + OBJECTIVE_FIXED <= header:
            if struct.unpack_from("<I", record, pos)[0] < 1000 or record[pos + 4] > 30:
                break
            effects = struct.unpack_from("<i", record, pos + OBJECTIVE_EFFECTS)[0]
            if not 0 <= effects <= 8 or pos + OBJECTIVE_FIXED + 4 * effects > header:
                break
            desc_len = record[pos + OBJECTIVE_DESCRIPTION_LENGTH + 4 * effects]
            desc_start = pos + OBJECTIVE_FIXED + 4 * effects
            end = desc_start + desc_len
            if end > header:
                break
            try:
                record[desc_start:end].decode("utf-8")
            except UnicodeDecodeError:
                break
            ids.append(struct.unpack_from("<I", record, pos)[0])
            amounts.append(struct.unpack_from("<i", record, pos + 13)[0])
            pos = end
        if pos == header and amounts and all(0 < b - a < 64 for a, b in zip(ids, ids[1:])):
            if all(0 < amount < 10000 for amount in amounts) and (best is None or len(amounts) > len(best)):
                best = amounts
    return best


def _looks_like_title(text: str) -> bool:
    return (0 < len(text) <= 120 and "\n" not in text and not text[0].islower()
            and not text.startswith(" ") and all(ord(char) >= 32 for char in text))


def parse_record(record: bytes) -> dict[str, str] | None:
    candidates = []
    for pos in range(0, len(record) - HEADER_LEN):
        lengths = _lengths(record, pos)
        total = sum(lengths)
        if lengths[0] == 0 or total > len(record) - pos - HEADER_LEN:
            continue
        strings, offset = {}, len(record) - total
        try:
            for (name, _), length in zip(STRING_FIELDS, lengths):
                strings[name] = record[offset:offset + length].decode("utf-8")
                offset += length
        except UnicodeDecodeError:
            continue
        if not _looks_like_title(strings["title"]) or not strings["logDescription"]:
            continue
        amounts = _objective_chain(record, pos)
        candidates.append((amounts is not None, pos, strings, amounts or []))
    if not candidates:
        return None
    candidates.sort(key=lambda candidate: (candidate[0], candidate[1]))
    _, _, strings, amounts = candidates[-1]
    for name in ("logDescription", "questDescription", "completionLog"):
        strings[name] = strings[name].replace("\r\n", "$B").replace("\n", "$B")
    # The client uses $1oa-style placeholders for objective amounts in cached text.
    for index, amount in enumerate(amounts, 1):
        strings["logDescription"] = strings["logDescription"].replace(f"${index}oa", str(amount))
        strings["questDescription"] = strings["questDescription"].replace(f"${index}oa", str(amount))
    return strings


def quest_texts(path: Path) -> tuple[str, int, dict[int, dict[str, str]]]:
    _, build, locale, records = read_wdb(path)
    parsed = {}
    for quest_id, record in records.items():
        text = parse_record(record)
        if text:
            parsed[quest_id] = text
    return locale, build, parsed
