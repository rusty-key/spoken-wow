"""Lua source for the tables the pipeline writes.

Keys and values are what players saw in game or sent in from /contribute, so they are written
as real Lua literals: a bare backslash would escape the quote that closes the key, and the
whole data file would fail to compile for every player holding the pack.
"""

ESCAPES = {"\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r"}


def lua_string(text: str) -> str:
    """A double-quoted Lua string literal that reads back as exactly `text`."""
    out = []
    for ch in text:
        if ch in ESCAPES:
            out.append(ESCAPES[ch])
        elif ord(ch) < 32 or ord(ch) == 127:
            # Three digits always: Lua reads up to three after the backslash, so "\9" before
            # a digit in the text would swallow it.
            out.append(f"\\{ord(ch):03d}")
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def lua_value(value, depth: int = 0) -> str:
    """A Lua literal for a str, bool, int, float, None, list or dict, nested tables indented."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "nil"
    if isinstance(value, str):
        return lua_string(value)
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        items = [(lua_key(key), lua_value(item, depth + 1)) for key, item in value.items()]
        return lua_block([f"{key} = {item}" for key, item in items], depth)
    if isinstance(value, (list, tuple)):
        return lua_block([lua_value(item, depth + 1) for item in value], depth)
    raise TypeError(f"no Lua literal for {type(value).__name__}")


def lua_key(key) -> str:
    if isinstance(key, bool) or not isinstance(key, (int, str)):
        raise TypeError(f"no Lua table key for {type(key).__name__}")
    return f"[{key}]" if isinstance(key, int) else f"[{lua_string(key)}]"


def lua_block(entries: list, depth: int) -> str:
    if not entries:
        return "{}"
    inner = "\t" * (depth + 1)
    return "{\n" + ",\n".join(inner + entry for entry in entries) + "\n" + "\t" * depth + "}"
