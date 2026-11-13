"""Forever export matching: a translation lands only on the English it was made from."""
import csv

from tts_cli.forever_csv import load, match_quest_line, match_title, shown, strip_items, template

# q:5 accept, as the corpus stores it, and as Forever's export has it, a paragraph a row.
JITTERS = ("I've been stuck hiding in this ghost town for weeks, and I haven't eaten anything but "
           "grubs and weeds!  I need some decent food, and I'm willing to trade well for it.$B$B"
           "Bring me a feast and I'll pay you handsomely.")
JITTERS_ROWS = [
    ("I've been stuck hiding in this ghost town for weeks, and I haven't eaten anything but grubs "
     "and weeds! I need some decent food, and I'm willing to trade well for it.", "Tôi bị kẹt ở đây."),
    ("Bring me a feast and I'll pay you handsomely.", "Mang cho tôi một bữa tiệc, <name>."),
]


class TestShape:
    def test_our_template_reads_as_the_client_shows_it(self):
        assert shown("Hello, $ggood sir:my lady;!  Well met, $c.$B$BGo, $N.") == \
            "Hello, <good sir/my lady>! Well met, <class>.\nGo, <name>."

    def test_a_translation_becomes_a_template(self):
        assert template(["Chào <chàng trai/cô gái>, <class>.", "Đi đi, <name>."],
                        "Hello, $gboy:girl;, $c.$B$BGo, $N.") == \
            "Chào $Gchàng trai:cô gái;, $C.$B$BĐi đi, $N."

    def test_a_slash_is_a_gender_only_where_the_english_has_one(self):
        assert template(["<Thở dài/rên rỉ>"], "<Sighs>") == "<Thở dài/rên rỉ>"


class TestMatch:
    def test_the_paragraphs_of_our_english_match(self):
        assert match_quest_line({"DESCRIPTION": JITTERS_ROWS}, "accept", JITTERS) == \
            ("Tôi bị kẹt ở đây.$B$BMang cho tôi một bữa tiệc, $N.", "matched")

    def test_english_forever_rewrote_is_left_out(self):
        entry = {"COMPLETION": [("Excellent work, <name>!", "Làm tốt lắm, <name>!")]}
        assert match_quest_line(entry, "complete", "You've done well, $N.") == (None, "changed")

    def test_a_gender_forever_resolved_is_left_out(self):
        entry = {"COMPLETION": [("Hello, fancy boy!", "Chào chàng trai!")]}
        assert match_quest_line(entry, "complete", "Hello, fancy $gboy:girl;!") == (None, "changed")

    def test_a_spelled_out_class_matches_the_token(self):
        entry = {"COMPLETION": [("Used by a <class> who was ready.", "Một <class> đã sẵn sàng.")]}
        assert match_quest_line(entry, "complete", "Used by a paladin who was ready.")[1] == "matched"

    def test_a_field_left_in_english_is_untranslated(self):
        entry = {"COMPLETION": [("Thank you.", "Thank you.")]}
        assert match_quest_line(entry, "complete", "Thank you.") == (None, "untranslated")
        assert match_quest_line({}, "complete", "Thank you.") == (None, "untranslated")


class TestItems:
    def test_a_progress_text_loses_the_items_forever_appends(self):
        entry = {"PROGRESS": [
            ("Have you brought it? Thunder Ale (1) Dark Iron Ale (5)",
             "Ngươi mang tới chưa? Thunder Ale (1) Bia Dark Iron (5)")]}
        assert match_quest_line(entry, "progress", "Have you brought it?") == ("Ngươi mang tới chưa?", "matched")

    def test_items_in_a_paragraph_of_their_own_go_with_it(self):
        assert strip_items(["Xong chưa?", "Cánh Kền Kền Nướng (10) Rượu Vang (5)"], 2) == ["Xong chưa?"]

    def test_items_with_no_sentence_before_them_cannot_be_cut(self):
        assert strip_items(["Thunder Ale (1)"], 1) is None

    def test_only_progress_text_carries_items(self):
        entry = {"COMPLETION": [("Thanks. Thunder Ale (1)", "Cảm ơn. Thunder Ale (1)")]}
        assert match_quest_line(entry, "complete", "Thanks.") == (None, "changed")


def test_a_title_matches_only_our_english():
    entry = {"TITLE": [("Sharptalon's Claw", "Móng vuốt của Sharptalon")]}
    assert match_title(entry, "Sharptalon's Claw") == "Móng vuốt của Sharptalon"
    assert match_title(entry, "Sharptalon's Talon") is None


def test_an_export_loads_its_paragraphs_in_order(tmp_path):
    path = tmp_path / "forever-mission-viVN-20261013-091803.csv"
    header = ["schema_version", "section", "language", "resource_id", "speaker", "segment", "line_nb",
              "source_hash", "source_text_en_read_only", "translation_text_fill_here",
              "current_status_read_only"]
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for nb in (2, 1):
            en, tr = JITTERS_ROWS[nb - 1]
            writer.writerow([1, "mission", "viVN", 5, "", "DESCRIPTION", nb, "x", en, tr, "3_EDITED"])
    data = load(path)
    assert data["language"] == "viVN"
    assert data["stamp"] == "20261013-091803"
    assert data["quests"]["5"]["DESCRIPTION"] == JITTERS_ROWS
