"""Run where opensmile is installed: python -m pytest scripts/test_voice_measure.py"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")

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
    pytest.importorskip("opensmile")
    low, high = tmp_path / "low.wav", tmp_path / "high.wav"
    tone(low, 110)
    tone(high, 220)
    result = run(low, high)
    assert result[str(low)]["f0Hz"] == pytest.approx(110, rel=0.08)
    assert result[str(high)]["f0Hz"] > result[str(low)]["f0Hz"]
    assert set(result[str(low)]) >= {"f0Hz", "hnrDb", "alphaRatioDb", "voicedPerSec"}


def test_reports_an_unreadable_file_without_failing_the_rest(tmp_path):
    pytest.importorskip("opensmile")
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


def test_measures_formants_and_duration(tmp_path):
    pytest.importorskip("opensmile")
    pytest.importorskip("librosa")
    clip = tmp_path / "clip.wav"
    tone(clip, 120, seconds=2.5, rate=44100)
    result = run(clip)[str(clip)]
    assert {"f1Hz", "f2Hz", "f3Hz"} <= set(result)
    assert result["durationSec"] == pytest.approx(2.5, abs=0.05)


def test_draws_the_view_as_a_png(tmp_path):
    pytest.importorskip("matplotlib")
    pytest.importorskip("librosa")
    reference, live, new = (tmp_path / f"{name}.wav" for name in ("reference", "live", "new"))
    tone(reference, 90, seconds=9, rate=22050)
    tone(live, 110, rate=22050)
    tone(new, 140, rate=22050)
    out = tmp_path / "view.png"
    done = subprocess.run(
        [sys.executable, str(SCRIPT), "--view", str(out), str(reference), str(live), str(new), "v3"],
        capture_output=True, text=True, check=True,
    )
    assert json.loads(done.stdout) == {"image": True}
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_says_why_the_view_failed(tmp_path):
    pytest.importorskip("matplotlib")
    bad = tmp_path / "bad.wav"
    bad.write_bytes(b"not audio")
    done = subprocess.run(
        [sys.executable, str(SCRIPT), "--view", str(tmp_path / "view.png"), str(bad), str(bad), str(bad)],
        capture_output=True, text=True, check=True,
    )
    assert "error" in json.loads(done.stdout)


def phrases(path, hz_from, hz_to, gaps, rate=22050):
    """Buzzed phrases of 1 s, each gliding from hz_from to hz_to, with `gaps` seconds of silence between."""
    parts = []
    for gap in gaps + [0]:
        t = np.arange(rate) / rate
        f = np.linspace(hz_from, hz_to, t.size)
        phase = 2 * np.pi * np.cumsum(f) / rate
        parts.append(sum(np.sin(phase * k) / k for k in range(1, 8)) * 0.5)
        parts.append(np.zeros(int(gap * rate)))
    signal = np.concatenate(parts)
    samples = (signal / np.abs(signal).max() * 0.5 * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(samples.tobytes())


def test_measures_pauses_and_phrase_ends(tmp_path):
    pytest.importorskip("librosa")
    falling, rising, run_on = tmp_path / "falling.wav", tmp_path / "rising.wav", tmp_path / "run_on.wav"
    phrases(falling, 160, 110, [0.6, 0.6, 0.6])
    phrases(rising, 110, 160, [0.6, 0.6, 0.6])
    phrases(run_on, 160, 110, [])
    result = run(falling, rising, run_on)
    assert result[str(falling)]["pauseRate"] == pytest.approx(0.75, abs=0.15)
    assert result[str(falling)]["pauseMeanSec"] == pytest.approx(0.6, abs=0.1)
    assert result[str(run_on)]["pauseRate"] == 0
    assert result[str(falling)]["phraseEndSt"] < -1
    assert result[str(rising)]["phraseEndSt"] > 1
    assert result[str(falling)]["f0SdSt"] > 1
