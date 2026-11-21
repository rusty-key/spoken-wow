-- An interface pack's strings for this module (Spoken's Interface.lua), laid over the built-in
-- language's that the locale files above registered, before any other file reads them.
local _, SpokenPlaces = ...

local strings = SpokenPlaces.Strings[SpokenPlaces.interfaceBase]
if strings and Spoken and Spoken.ApplyInterfaceStrings then Spoken:ApplyInterfaceStrings("Places", strings) end
