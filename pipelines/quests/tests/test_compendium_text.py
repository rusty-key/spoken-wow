"""The corpus export used by a language pack's Compendium page."""

from tts_cli.compendium_text import (compendium_ids, load_compendium_text,
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


def test_corpus_rows_select_title_accept_and_complete(tmp_path):
    rows = [
        {"questId": 7, "source": "accept", "lineId": "a", "localeText": "Oferta\nuno"},
        {"questId": 7, "source": "accept", "lineId": "b", "localeText": "Oferta\nuno"},
        {"questId": 7, "source": "complete", "lineId": "c", "localeText": "Entrega"},
        {"questId": 7, "source": "progress", "lineId": "p", "localeText": "Progreso"},
        {"questId": 8, "source": "progress", "lineId": "p", "localeText": "Solo progreso"},
        {"questId": 9, "source": "gossip", "lineId": "g", "localeText": "Ignorar"},
    ]
    names = {7: "Misión", 8: "Otra misión", 9: "No está en el índice"}

    assert localized_quest_text(rows, names, {7, 8}) == {
        7: {"title": "Misión", "accept": "Oferta$Buno", "complete": "Entrega"},
        8: {"title": "Otra misión", "accept": "Solo progreso"},
    }


def test_compendium_text_round_trips_deterministically(tmp_path):
    path = tmp_path / "esMX" / "compendium-text.json.gz"
    quests = {47: {"title": "Intercambio", "accept": "Oferta"}}

    write_compendium_text(path, "esMX", quests)
    first = path.read_bytes()
    assert load_compendium_text(path) == ("esMX", quests)

    write_compendium_text(path, "esMX", quests)
    assert path.read_bytes() == first
