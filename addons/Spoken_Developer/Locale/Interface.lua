-- An interface pack's strings for this module (Spoken's Interface.lua), laid over the ones the
-- locale files above loaded, before any other file reads them.
local _, Developer = ...

if Spoken and Spoken.ApplyInterfaceStrings then Spoken:ApplyInterfaceStrings("Developer", Developer.L) end
