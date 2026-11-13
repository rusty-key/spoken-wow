"""The rule deciding which store files scripts/quests/package-audio.sh has to re-encode."""
import importlib.util
import os

TOOL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "tools", "plan_transcode.py")

_spec = importlib.util.spec_from_file_location("plan_transcode", TOOL)
plan_transcode = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(plan_transcode)

plan_action = plan_transcode.plan_action


def test_a_dense_clip_is_transcoded_into_the_same_format():
    assert plan_action(128, ".mp3", ".mp3", 80) == "encode"


def test_a_clip_already_below_the_threshold_is_copied():
    # -q:a 6 lands around 65 kbps on this speech, so a second lossy pass over a 64 kbps
    # clip produces a file no smaller and audibly worse.
    assert plan_action(64, ".mp3", ".mp3", 80) == "copy"


def test_changing_format_ignores_the_bitrate_gate():
    # The gate compares like with like. A 64 kbps mp3 still has to become an ogg, or the
    # module would ship two formats and resolve half its lines to nothing.
    assert plan_action(64, ".mp3", ".ogg", 80) == "encode"
