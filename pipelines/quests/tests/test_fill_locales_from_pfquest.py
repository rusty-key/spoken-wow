"""Reading pfQuest's quest tables, and which of the dump's cells their text may replace."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from fill_locales_from_pfquest import plan, read_quests  # noqa: E402


def test_pfquest_tables_are_read_with_their_escapes():
    source = ('pfDB["quests"]["ptBR"]={[2]={["D"]="Diga \\"olá\\", $N.$B$BTchau.",'
              '["O"]="Leve a Garra.",["T"]="Garra",},[3]={["T"]="",},}')
    assert read_quests(source) == {
        2: {"Details": 'Diga "olá", $N.$B$BTchau.', "Objectives": "Leve a Garra.", "Title": "Garra"},
    }


def test_pfquest_tables_spread_over_lines_are_read_whole():
    source = ('pfDB["quests"]["ptBR"] = {\n'
              '  [2] = {\n    ["D"] = "Fecha },\\n e segue.",\n    ["T"] = "Garra",\n  },\n'
              '  [3] = { ["T"] = "Sem vírgula" }\n}')
    assert read_quests(source) == {
        2: {"Details": "Fecha },\n e segue.", "Title": "Garra"},
        3: {"Title": "Sem vírgula"},
    }


ENGLISH = {1: {"Details": {"It's no secret that the Defias Gang wear red bandanas, $n."},
               "Title": {"Red Silk Bandanas"}}}
PORTUGUESE = "Não é segredo que a gangue Défias usa bandanas vermelhas, $n."
LEAKED = "It's no secret that the Defias Gang wear red bandanas, $n."


def test_english_in_the_dump_is_replaced_and_a_translation_kept():
    writes, _ = plan({1: {"Details": PORTUGUESE}}, ENGLISH, {1: {"Details": LEAKED}})
    assert writes == {1: {"Details": PORTUGUESE}}
    kept = "Todo mundo sabe que os Défias usam bandanas, $n."
    writes, _ = plan({1: {"Details": PORTUGUESE}}, ENGLISH, {1: {"Details": kept}})
    assert writes == {}


def test_english_from_pfquest_is_never_written():
    writes, _ = plan({1: {"Details": LEAKED}}, ENGLISH, {})
    assert writes == {}


def test_english_nothing_replaces_is_cleared():
    writes, _ = plan({}, ENGLISH, {1: {"Details": LEAKED, "Title": "Red Silk Bandanas"}})
    assert writes == {1: {"Details": None, "Title": None}}
