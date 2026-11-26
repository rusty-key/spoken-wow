"""Measure voices for /voices/design.

Usage: python voice_measure.py <audio file>...
Prints one JSON object, file path to its measures or to {"error": "..."}.

Two independent parts, each used when its library is installed:
- openSMILE eGeMAPS functionals over the whole file (pitch, roughness, brightness). Only the
  differences between voices mean much: game audio is pitch-shifted and processed.
- librosa: the s-level, room tail and speech level a preview is chosen by (see recommendedPreview
  in lib/voice-design/limits.ts), measured the way round two measured them.

Run by the site (lib/voice-design/measure.ts) with the interpreter named by VOICE_ANALYSIS_PYTHON;
mp3 needs ffmpeg on PATH.
"""
import json
import sys

FEATURES = {
    "f0St": "F0semitoneFrom27.5Hz_sma3nz_amean",
    "f0RangeSt": "F0semitoneFrom27.5Hz_sma3nz_pctlrange0-2",
    "hnrDb": "HNRdBACF_sma3nz_amean",
    "jitter": "jitterLocal_sma3nz_amean",
    "shimmerDb": "shimmerLocaldB_sma3nz_amean",
    "alphaRatioDb": "alphaRatioV_sma3nz_amean",
    "hammarbergDb": "hammarbergIndexV_sma3nz_amean",
    "h1h2Db": "logRelF0-H1-H2_sma3nz_amean",
    "loudness": "loudness_sma3_amean",
    "voicedPerSec": "VoicedSegmentsPerSec",
}


def smile_measures(smile, path):
    row = smile.process_file(path).iloc[0]
    out = {key: float(row[column]) for key, column in FEATURES.items()}
    # Semitones above 27.5 Hz, as eGeMAPS reports pitch, read back as hertz.
    out["f0Hz"] = 27.5 * 2 ** (out.pop("f0St") / 12)
    return out


def sibilance(path):
    """ess: 95th percentile of the 5-10 kHz energy share on the loudest 40% of frames, where the
    s sounds are. decay: mean dB 3-12 hops after a phrase ends, relative to its end: the room.
    level: 90th percentile RMS in dBFS: how loud the speech is."""
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=44100, mono=True)
    power = np.abs(librosa.stft(y, n_fft=2048, hop_length=512)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    total = power.sum(0) + 1e-12
    high = power[(freqs >= 5000) & (freqs <= 10000)].sum(0) / total
    loud = total > np.percentile(total, 60)
    ess = float(np.percentile(high[loud], 95))

    rms = librosa.feature.rms(y=y, hop_length=512)[0]
    db = 20 * np.log10(rms + 1e-9)
    ends = np.where((db[:-12] > db.max() - 25) & (db[12:] < db.max() - 45))[0]
    decay = float(np.mean([db[e + 3 : e + 12].mean() - db[e] for e in ends])) if len(ends) else None

    level = float(np.percentile(db, 90))
    out = {"ess": round(ess, 3), "level": round(level, 1)}
    if decay is not None:
        out["decay"] = round(decay, 1)
    return out


def main(paths):
    try:
        import opensmile

        smile = opensmile.Smile(
            feature_set=opensmile.FeatureSet.eGeMAPSv02,
            feature_level=opensmile.FeatureLevel.Functionals,
        )
    except ImportError:
        smile = None

    result = {}
    for path in paths:
        measured, errors = {}, []
        # Each part on its own: one unreadable clip or missing library must not cost the rest.
        for part in ([lambda p: smile_measures(smile, p)] if smile else []) + [sibilance]:
            try:
                measured.update(part(path))
            except Exception as error:
                errors.append(str(error)[:300])
        result[path] = measured if measured else {"error": "; ".join(errors) or "nothing measured"}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1:])
