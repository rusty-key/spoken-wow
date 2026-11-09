"""The corpus export used by a language pack's Compendium page."""

from tts_cli.compendium_text import (clean, compendium_ids, load_compendium_text,
                                     localized_quest_text, write_compendium_text)


def test_only_compendium_quests_are_selected(tmp_path):
    path = tmp_path / "Compendium.lua"
    path.write_text(
        "SpokenQuestsCompendium = {\n"
        "\tquests = {\n"
        "\t\t[7] = { \"Quest\" },\n"
        "\t},\n"
        "\tsorts = {\n"
        "\t\t[7] = { \"Sort\" },\n"
        "\t},\n"
        "}\n",
        encoding="utf-8",
    )

    assert compendium_ids(path) == {7}


def _line(quest, source, title="Quest"):
    return {"questId": quest, "source": source, "lineId": f"q:{quest}:{source}",
            "originalText": "English.", "questTitle": title}


def _row(quest, source, text, line_id=None):
    return {"questId": quest, "source": source, "lineId": line_id or f"q:{quest}:{source}",
            "localeText": text}


def test_corpus_rows_select_title_accept_and_complete():
    corpus = {"lines": [_line(7, "accept"), _line(7, "complete"), _line(8, "progress")]}
    rows = [
        _row(7, "accept", "Oferta\nuno", "q:7:accept"),
        _row(7, "accept", "Oferta\nuno", "q:7:accept:w2"),
        _row(7, "complete", "Entrega"),
        _row(7, "progress", "Progreso"),
        _row(8, "progress", "Solo progreso"),
        _row(9, "gossip", "Ignorar"),
    ]
    names = {7: "Misión", 8: "Otra misión", 9: "No está en el índice"}

    assert localized_quest_text(rows, names, {7, 8}, corpus) == {
        7: {"title": "Misión", "accept": "Oferta$Buno", "complete": "Entrega"},
        8: {"title": "Otra misión", "accept": "Solo progreso"},
    }


def test_progress_is_not_the_offer_where_the_english_has_one():
    corpus = {"lines": [_line(7, "accept"), _line(7, "complete"), _line(7, "progress")]}

    assert localized_quest_text([_row(7, "progress", "¿Ya lo tienes?")], {}, {7}, corpus) == {}


def test_a_title_equal_to_the_english_is_left_to_the_client():
    corpus = {"lines": [_line(7, "accept", title="Hogger")]}

    assert localized_quest_text([], {7: "Hogger"}, {7}, corpus) == {}


def test_an_ignored_line_is_left_out():
    corpus = {"lines": [_line(7, "accept"), _line(7, "complete")]}
    rows = [_row(7, "accept", "Muerta"), _row(7, "complete", "Entrega")]

    assert localized_quest_text(rows, {}, {7}, corpus, {"q:7:accept": "dead"}) == {
        7: {"complete": "Entrega"},
    }


def test_a_gendered_translation_of_an_ignored_line_is_left_out():
    corpus = {"lines": [_line(7, "accept"), _line(7, "complete")]}
    rows = [_row(7, "accept", "Muerto", "q:7:accept:m"), _row(7, "accept", "Muerta", "q:7:accept:f"),
            _row(7, "complete", "Entrega")]

    assert localized_quest_text(rows, {}, {7}, corpus, {"q:7:accept": "dead"}) == {
        7: {"complete": "Entrega"},
    }


def test_objective_amounts_are_written_in():
    corpus = {"lines": [_line(7, "accept")]}
    rows = [_row(7, "accept", "Trae $2oa balas, $1oa flechas y $3oa más.")]

    assert localized_quest_text(rows, {}, {7}, corpus, amounts={7: [10, 200]}) == {
        7: {"accept": "Trae 200 balas, 10 flechas y $3oa más."},
    }


def test_blank_lines_at_the_ends_are_dropped():
    assert clean("\n Oferta\n\nuna\n\n") == "Oferta$B$Buna"


def test_compendium_text_round_trips_deterministically(tmp_path):
    path = tmp_path / "esMX" / "compendium-text.json.gz"
    quests = {47: {"title": "Intercambio", "accept": "Oferta"}}

    write_compendium_text(path, "esMX", quests)
    first = path.read_bytes()
    assert load_compendium_text(path) == ("esMX", quests)

    write_compendium_text(path, "esMX", quests)
    assert path.read_bytes() == first
