"""Measure voices for /voices/design: openSMILE eGeMAPS functionals over each whole file.

Usage: python voice_measure.py <audio file>...
Prints one JSON object, file path to its measures or to {"error": "..."}.

Run by the site (lib/voice-design/measure.ts) with the interpreter named by VOICE_ANALYSIS_PYTHON,
which needs `opensmile` installed; mp3 needs ffmpeg on PATH. Only the differences between voices
mean much: game audio is pitch-shifted and processed, so absolute values mislead.
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


def measures(row):
    out = {key: float(row[column]) for key, column in FEATURES.items()}
    # Semitones above 27.5 Hz, as eGeMAPS reports pitch, read back as hertz.
    out["f0Hz"] = 27.5 * 2 ** (out.pop("f0St") / 12)
    return out


def main(paths):
    import opensmile

    smile = opensmile.Smile(
        feature_set=opensmile.FeatureSet.eGeMAPSv02,
        feature_level=opensmile.FeatureLevel.Functionals,
    )
    result = {}
    for path in paths:
        try:
            result[path] = measures(smile.process_file(path).iloc[0])
        except Exception as error:  # one unreadable clip must not cost the others theirs
            result[path] = {"error": str(error)[:300]}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1:])
