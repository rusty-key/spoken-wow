-- Add a character by the GUID that /dump UnitGUID("player") prints in game.
-- Every generated sound pack ships a copy as Developers.lua, so a pack released after Spoken can tag a newer
-- developer. No setfenv: a pack may load before Spoken's environment exists. Copies only add, so
-- a removed character stays tagged until no installed pack still lists it.
local developers = {
    -- Anon
    ["Player-5149-04564413"] = true,
    ["Player-5149-04987F43"] = true,
    ["Player-6921-001E5110"] = true,
    ["Player-6921-02CAC851"] = true,
    -- Brock
    ["Player-6930-0019D2DA"] = true,
    -- Loukky
    ["Player-7124-0158514C"] = true,
    -- Juudal
    ["Player-6785-00B1F74A"] = true,
    ["Player-6785-000D9EDD"] = true,
    -- Ranfred (conoar)
    ["Player-6949-00219DC4"] = true,
    ["Player-6949-0021AECE"] = true,
    ["Player-6949-0021A0D8"] = true,
    ["Player-6949-05E29238"] = true,
}

SpokenDeveloperCharacters = SpokenDeveloperCharacters or {}
for guid in pairs(developers) do
    SpokenDeveloperCharacters[guid] = true
end
