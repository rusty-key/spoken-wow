"""The quest before each one in its chain, as the Compendium's data gives it (export_compendium.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from export_compendium import chain_links, quest_line, quest_line_links  # noqa: E402


def _row(prev=0, nxt=0, group=0, breadcrumb=0):
    return {"prev": prev, "next": nxt, "group": group, "breadcrumb": breadcrumb}


def test_a_quest_comes_after_the_one_it_needs_handed_in():
    rows = {1: _row(), 2: _row(prev=1), 3: _row(prev=2)}
    assert chain_links(rows, {1, 2, 3}) == {2: 1, 3: 2}


def test_a_quest_needing_another_only_in_the_log_does_not_come_after_it():
    rows = {1: _row(), 2: _row(prev=-1)}
    assert chain_links(rows, {1, 2}) == {}


def test_next_quest_links_where_the_next_names_no_prev_of_its_own():
    rows = {1: _row(nxt=2), 2: _row(), 3: _row(nxt=5), 4: _row(), 5: _row(prev=4)}
    assert chain_links(rows, {1, 2, 3, 4, 5}) == {2: 1, 5: 4}


def test_several_quests_opening_one_leave_the_lowest_before_it():
    rows = {11: _row(nxt=20, group=-11), 10: _row(nxt=20, group=-11), 20: _row()}
    assert chain_links(rows, {10, 11, 20}) == {20: 10}


def test_a_breadcrumb_comes_before_its_quest_only_where_nothing_else_does():
    rows = {1: _row(breadcrumb=3), 2: _row(), 3: _row(), 4: _row(breadcrumb=5), 5: _row(prev=2)}
    assert chain_links(rows, {1, 2, 3, 4, 5}) == {3: 1, 5: 2}


def test_a_quest_the_corpus_lacks_is_passed_through():
    rows = {1: _row(), 2: _row(prev=1), 3: _row(prev=2)}
    assert chain_links(rows, {1, 3}) == {3: 1}


def test_a_loop_is_broken_so_the_chain_has_a_first_quest():
    rows = {1: _row(prev=3), 2: _row(prev=1), 3: _row(prev=2)}
    links = chain_links(rows, {1, 2, 3})
    assert len(links) == 2
    first = [q for q in (1, 2, 3) if q not in links]
    assert len(first) == 1


def test_a_quest_offered_after_one_other_follows_it_where_nothing_else_links_it():
    # 5 Jitters' Growling Gut, offered on handing in 163 Raven Hill (RewardNextQuest).
    rows = {163: {**_row(), "reward": 5}, 5: _row()}
    assert chain_links(rows, {5, 163}) == {5: 163}
    # 97222 Gatehouse Goods keeps the client's link; the offer comes last.
    rows = {97242: {**_row(), "reward": 97222}, 97222: _row()}
    assert chain_links(rows, {97220, 97222, 97242}, {97220: 97222}) == {97222: 97220}


def test_a_quest_offered_after_several_or_after_one_the_corpus_lacks_follows_none():
    # 4490 Summon Felsteed, offered after 3631 and 4487-4489; 869 Raptor Thieves after 14066.
    rows = {3631: {**_row(), "reward": 4490}, 4487: {**_row(), "reward": 4490}, 4490: _row(),
            14066: {**_row(prev=905), "reward": 869}, 905: _row(), 869: _row()}
    assert chain_links(rows, {3631, 4487, 4490, 905, 869}) == {}


def _line(line, order, qid):
    return {"QuestLineID": str(line), "OrderIndex": str(order), "QuestID": str(qid)}


def test_a_client_quest_line_links_its_quests_by_their_order():
    # Toxic Soil (QuestLine 6026), which neither the DB nor nextQuestId links.
    lines = quest_line_links([_line(6026, 1, 92744), _line(6026, 0, 92742), _line(6026, 2, 92745)])
    assert lines == {92744: 92742, 92745: 92744}
    assert chain_links({}, {92742, 92744, 92745}, None, lines) == {92744: 92742, 92745: 92744}


def test_a_quest_line_links_only_where_the_db_and_the_clients_next_quest_do_not():
    rows = {1: _row(), 2: _row(prev=1), 3: _row(), 4: _row(), 5: _row()}
    lines = quest_line_links([_line(7, 0, 3), _line(7, 1, 2), _line(7, 2, 4), _line(7, 3, 5)])
    assert chain_links(rows, {1, 2, 3, 4, 5}, {1: 4}, lines) == {2: 1, 4: 1, 5: 4}


def test_the_quest_line_names_the_one_before():
    assert quest_line(3, "Third", zones=[1429], prev=2) == '\t\t[3] = { "Third", zones = { 1429 }, prev = 2 },'
    assert "prev" not in quest_line(1, "First", zones=[1429])
