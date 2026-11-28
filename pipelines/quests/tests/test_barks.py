from tts_cli.barks import bark_rows, decide_bark, parse_type, set_rows


def S(voice, greeting, farewell, pissed):
    return {"voice": voice, "greeting": greeting, "farewell": farewell, "pissed": pissed}


def by_id(rows):
    return {row["setId"]: row for row in rows}


def row(game_file, kind, text):
    return {"gameFile": game_file, "race": "orc", "gender": "female", "flavor": "standard",
            "kind": kind, "text": text}


def test_parse_type():
    assert parse_type("orc-female-standard") == ("orc", "female", "standard")
    assert parse_type("bloodelf-female") == ("bloodelf", "female", None)


def test_untyped_set_inside_a_typed_one_takes_its_type():
    sets = {"95": S("dwarf-female-guard", [1, 2], [3], [4]), "154": S(None, [1, 2], [3], [4])}
    assert by_id(set_rows(sets))[154]["race"] == "dwarf"


def test_untyped_set_with_its_own_files_stays_untyped():
    sets = {"95": S("dwarf-female-guard", [1], [], []), "3742": S(None, [9], [9], [9])}
    assert by_id(set_rows(sets))[3742]["race"] is None


def test_a_file_in_two_sets_of_one_type_is_one_bark():
    sets = {"57": S("orc-female-standard", [1], [2], [3]),
            "124": S("orc-female-standard", [1, 5], [2], [3])}
    texts = {"1": "Mok'ra.", "2": "Be safe.", "3": "Back off.", "5": "Need something?"}
    rows = bark_rows(set_rows(sets), texts, lambda *t: True)
    assert sorted(r["gameFile"] for r in rows) == [1, 2, 3, 5]


def test_unvoiced_type_and_untranscribed_file_get_no_bark():
    sets = {"57": S("orc-female-standard", [1, 2], [], [])}
    assert bark_rows(set_rows(sets), {"1": "Hi."}, lambda *t: True) == [row(1, "greeting", "Hi.")]
    assert bark_rows(set_rows(sets), {"1": "Hi."}, lambda *t: False) == []


def test_bark_version_rule():
    assert decide_bark(None, "Hi.") == "insert"
    assert decide_bark({"origin": "extracted", "originalText": "Hi."}, "Hi.") == "skip"
    assert decide_bark({"origin": "extracted", "originalText": "Hi."}, "Hello.") == "version"
    assert decide_bark({"origin": "edited", "originalText": "Hi."}, "Hello.") == "skip"
