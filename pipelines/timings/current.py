"""Whether a recording is still the one a results row was measured on."""
import os


def unchanged(row, path):
    """True while `path` is the recording `row` was measured on.

    Rows carry the file's size, which a re-cut recording does not keep. Older rows have only the
    decoded length, which mutagen reads about 0.04 s longer than the decoder does for an mp3, so
    they are compared loosely.
    """
    if not path or not os.path.exists(path):
        return False
    if "bytes" in row:
        return os.path.getsize(path) == row["bytes"]
    from mutagen import File
    return abs(File(path).info.length - row["length"]) < 0.15
