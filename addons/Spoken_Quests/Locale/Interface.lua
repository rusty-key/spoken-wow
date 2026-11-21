-- An interface pack's strings for this module (Spoken's Interface.lua), laid over the ones the
-- locale files above loaded, before any other file reads them.
setfenv(1, VoiceOver)

if Spoken and Spoken.ApplyInterfaceStrings then Spoken:ApplyInterfaceStrings("Quests", L) end
