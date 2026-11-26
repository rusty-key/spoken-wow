"""Run where opensmile is installed: python -m pytest scripts/test_voice_measure.py"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("opensmile")

SCRIPT = Path(__file__).with_name("voice_measure.py")


def tone(path, hz, seconds=3.0, rate=16000):
    t = np.arange(int(seconds * rate)) / rate
    # A buzz rather than a pure sine: harmonics give the pitch tracker a voice-like signal.
    signal = sum(np.sin(2 * np.pi * hz * k * t) / k for k in range(1, 8))
    samples = (signal / np.abs(signal).max() * 0.5 * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(samples.tobytes())


def run(*paths):
    done = subprocess.run([sys.executable, str(SCRIPT), *map(str, paths)], capture_output=True, text=True, check=True)
    return json.loads(done.stdout)


def test_measures_pitch_in_hertz(tmp_path):
    low, high = tmp_path / "low.wav", tmp_path / "high.wav"
    tone(low, 110)
    tone(high, 220)
    result = run(low, high)
    assert result[str(low)]["f0Hz"] == pytest.approx(110, rel=0.08)
    assert result[str(high)]["f0Hz"] > result[str(low)]["f0Hz"]
    assert set(result[str(low)]) >= {"f0Hz", "hnrDb", "alphaRatioDb", "voicedPerSec"}


def test_reports_an_unreadable_file_without_failing_the_rest(tmp_path):
    good, bad = tmp_path / "good.wav", tmp_path / "bad.wav"
    tone(good, 150)
    bad.write_bytes(b"not audio")
    result = run(good, bad)
    assert "f0Hz" in result[str(good)]
    assert "error" in result[str(bad)]
