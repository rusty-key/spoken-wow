"""The per-language gossip text file export-locale-text writes and build reads."""
from tts_cli.corpus import write_corpus
from tts_cli.locale_text import load_locale_names, load_locale_text, write_locale_text

ROWS = [{"lineId": "g:abc123", "originalText": "Move along.", "localeText": "Circule."}]


def test_a_written_language_reads_back(tmp_path):
    path = write_locale_text(str(tmp_path / "esMX" / "locale-text.json.gz"), "esMX", ROWS)

    assert load_locale_text(path) == ("esMX", ROWS)


def test_writing_the_same_rows_twice_is_the_same_file(tmp_path):
    path = str(tmp_path / "locale-text.json.gz")
    write_locale_text(path, "esMX", ROWS)
    first = open(path, "rb").read()
    write_locale_text(path, "esMX", ROWS)

    assert open(path, "rb").read() == first


def test_its_names_read_back(tmp_path):
    names = [{"kind": "creature", "entityId": "68", "name": "Guardia de Ventormenta"}]
    path = write_locale_text(str(tmp_path / "locale-text.json.gz"), "esMX", ROWS, names)

    assert load_locale_names(path) == names


def test_a_file_from_before_names_has_none(tmp_path):
    path = str(tmp_path / "locale-text.json.gz")
    write_corpus(path, {"lang": "esMX", "lines": ROWS})

    assert load_locale_names(path) == []
