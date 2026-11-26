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


def noise_burst(path, rate=44100):
    """A buzz with bursts of high hiss between: what harsh s sounds look like to the s-level."""
    t = np.arange(int(3 * rate)) / rate
    signal = sum(np.sin(2 * np.pi * 120 * k * t) / k for k in range(1, 8)) * 0.3
    rng = np.random.default_rng(0)
    hiss = rng.normal(0, 1, t.size)
    from numpy.fft import irfft, rfft
    spectrum = rfft(hiss)
    freqs = np.fft.rfftfreq(t.size, 1 / rate)
    spectrum[(freqs < 5000) | (freqs > 10000)] = 0
    hiss = irfft(spectrum, t.size)
    gate = (np.sin(2 * np.pi * 2 * t) > 0.6).astype(float)
    signal = signal + hiss / np.abs(hiss).max() * gate * 0.8
    samples = (signal / np.abs(signal).max() * 0.5 * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(samples.tobytes())


def test_measures_s_level_room_and_level(tmp_path):
    pytest.importorskip("librosa")
    soft, harsh = tmp_path / "soft.wav", tmp_path / "harsh.wav"
    tone(soft, 120, rate=44100)
    noise_burst(harsh)
    result = run(soft, harsh)
    assert result[str(harsh)]["ess"] > result[str(soft)]["ess"] + 0.2
    assert -60 < result[str(soft)]["level"] < 0
