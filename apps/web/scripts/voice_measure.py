"""Measure voices for /voices/design.

Usage: python voice_measure.py <audio file>...
Prints one JSON object, file path to its measures or to {"error": "..."}.

       python voice_measure.py --view <out.png> <reference> <live> <new> [<new label>]
Draws the picture Claude reads for What's different: a mel spectrogram with the pitch track for
each clip, then their long-term average spectra. Prints {"image": true} or {"error": "..."}.

Two independent parts, each used when its library is installed:
- openSMILE eGeMAPS functionals over the whole file (pitch, roughness, brightness). Only the
  differences between voices mean much: game audio is pitch-shifted and processed.
- librosa: the s-level, room tail and speech level a preview is chosen by. Changing how they are
  measured changes what the page recommends, and makes old previews incomparable with new ones.

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
    "f1Hz": "F1frequency_sma3nz_amean",
    "f2Hz": "F2frequency_sma3nz_amean",
    "f3Hz": "F3frequency_sma3nz_amean",
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
    out = {"ess": round(ess, 3), "level": round(level, 1), "durationSec": round(len(y) / sr, 2)}
    if decay is not None:
        out["decay"] = round(decay, 1)
    return out


# The game clip runs to 30 s; seven of them show its voice and keep the rows the same scale.
VIEW_SECONDS = 7


def long_term_spectrum(path):
    """Mean power over the louder half of the frames, so pauses do not flatten it; dB below its peak."""
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=22050, mono=True)
    power = np.abs(librosa.stft(y, n_fft=2048)) ** 2
    energy = power.sum(0)
    spectrum = 10 * np.log10(power[:, energy > np.percentile(energy, 50)].mean(1) + 1e-12)
    return librosa.fft_frequencies(sr=sr, n_fft=2048), spectrum - spectrum.max()


def view(out, clips):
    import librosa
    import librosa.display
    import matplotlib
    import numpy as np

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig = plt.figure(figsize=(16, 13))
    for row, (label, path) in enumerate(clips, start=1):
        y, sr = librosa.load(path, sr=22050, mono=True, duration=VIEW_SECONDS)
        ax = fig.add_subplot(len(clips) + 1, 1, row)
        mel = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128, fmax=8000), ref=np.max)
        librosa.display.specshow(mel, sr=sr, x_axis="time", y_axis="mel", fmax=8000, ax=ax, cmap="magma")
        f0, _, _ = librosa.pyin(y, fmin=50, fmax=600, sr=sr)
        ax.plot(librosa.times_like(f0, sr=sr), f0, color="cyan", lw=2)
        ax.set_title(f"{label}: mel 0-8 kHz, cyan = pitch")
        ax.set_xlabel("")
    ax = fig.add_subplot(len(clips) + 1, 1, len(clips) + 1)
    for label, path in clips:
        freqs, spectrum = long_term_spectrum(path)
        ax.semilogx(freqs[1:], spectrum[1:], label=label, lw=2)
    ax.set_xlim(60, 10000)
    ax.set_ylim(-70, 2)
    ax.grid(True, which="both", alpha=0.3)
    ax.legend()
    ax.set_title("long-term average spectrum (dB, normalised)")
    fig.tight_layout()
    fig.savefig(out, dpi=70)
    plt.close(fig)


def main_view(args):
    out, reference, live, new = args[:4]
    label = args[4] if len(args) > 4 else "new"
    try:
        view(out, [("reference (game)", reference), ("live take", live), (label, new)])
        json.dump({"image": True}, sys.stdout)
    except Exception as error:
        json.dump({"error": str(error)[:300]}, sys.stdout)


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
    if sys.argv[1:2] == ["--view"]:
        main_view(sys.argv[2:])
    else:
        main(sys.argv[1:])
