-- An interface pack's strings for this module (Spoken's Interface.lua), laid over the ones the
-- locale files above loaded, before any other file reads them.
local _, Bosses = ...

if Spoken and Spoken.ApplyInterfaceStrings then Spoken:ApplyInterfaceStrings("Bosses", Bosses.L) end
