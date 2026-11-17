-- An interface pack's strings for this module (Spoken's Interface.lua), registered under the
-- Interface Language. The lookup reads them first, then the built-in language's, then English's.
local _, SpokenPlaces = ...

local strings = Spoken and Spoken.InterfaceStrings and Spoken:InterfaceStrings("Places")
if strings then SpokenPlaces:RegisterStrings(Spoken:InterfaceLanguage(), strings) end
