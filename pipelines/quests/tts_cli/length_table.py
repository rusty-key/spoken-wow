import os

from tts_cli.store import AUDIO_EXTENSIONS

DATAMODULE_TABLE_GUARD_CLAUSE = 'if not VoiceOver or not VoiceOver.DataModules then return end'

def _measured(sound_file: str) -> float:
    # Here rather than at the top: a build from pointers has no clips to read, and the droplet
    # installs no mutagen.
    import mutagen

    # mutagen.File sniffs the container, so mp3 and ogg are both read without a branch here;
    # a VBR mp3's Xing header and an Ogg page's granule position are both exact.
    return mutagen.File(sound_file).info.length

def write_sound_length_table_lua(module_name: str, sound_folder_path: str, output_folder_path: str,
                                 durations: dict = None):
    """`durations` is tts_cli.store.durations(), for a pack whose clips are pointers."""
    sound_files = []

    for root, dirs, files in os.walk(sound_folder_path):
        for f in files:
            if f.endswith(AUDIO_EXTENSIONS):
                sound_files.append(os.path.join(root, f))

    # Create a Lua table mapping the name of the sound to its length in seconds.
    soundDict = {}
    for sound_file in sound_files:
        stem = os.path.splitext(os.path.relpath(sound_file, sound_folder_path))[0]
        length = _measured(sound_file) if durations is None else float(durations[stem.replace(os.sep, "/")])
        soundDict[os.path.basename(stem)] = length

    # Sorted, because the walk's order is the filesystem's, and a reordered file is a download for
    # every player.
    with open(output_folder_path + '/sound_length_table.lua', "w") as f:
        f.write(DATAMODULE_TABLE_GUARD_CLAUSE + "\n")
        f.write(f"{module_name}.SoundLengthLookupByFileName = {{\n")
        for key, value in sorted(soundDict.items()):
            f.write(f"    [\"{key}\"] = {value},\n")
        f.write("}\n")
