-- The Small Window's portraits against the real queue, on tests/minimal-classic/fixture.lua, a
-- small UI and timer fixture: whose face a line shows as speakers, targets and the queue change,
-- the bounded cache of faces, and the badges. Also that every Lua file Spoken ships compiles as
-- Lua 5.1 and that its Minimal*.tga textures are power-of-two RGBA. The window itself is
-- tests/lua/minimal_window_test.lua's. Run with `make test-player`.
--
-- The blocks run the repository's own Lua: Spoken's files are loaded as the client loads them,
-- in order, into one Lua state, and the assertions read the frames the fixture builds.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
local ROOT = here .. "/../../"
local ADDON = ROOT .. "addons/Spoken/"

local function read(path)
    local file = assert(io.open(path, "rb"))
    local text = file:read("*a")
    file:close()
    -- The client skips a UTF-8 byte-order mark; Lua 5.1 does not.
    return (text:gsub("^\239\187\191", ""))
end

local function run(code, name)
    local chunk = assert(loadstring(code, name))
    chunk()
end

local function load(name) run(read(ADDON .. name), name) end

-- Every Lua file Spoken ships, its libraries and legacy trees included, compiles as Lua 5.1.
local files = 0
local list = assert(io.popen('git -C "' .. ROOT .. '" ls-files -- "addons/Spoken/*.lua"'))
for path in list:lines() do
    assert(loadstring(read(ROOT .. path), path))
    files = files + 1
end
list:close()
assert(files > 0, "git ls-files listed no Lua")
print("PASS: Lua 5.1 syntax for " .. files .. " addon/library files")

run(read(here .. "/fixture.lua"), "fixture.lua")
load("Environment.lua")
run([[
SpokenEnv.Version={IsRetailVanilla=false}]], "version stub")
load("Core.lua")
run([[

SpokenEnv.Addon.db={profile=SpokenEnv.Defaults.profile,char={IsPaused=false},global={}}
SpokenEnv.Addon.db.profile.Audio.AutoToggleDialog=false
SpokenEnv.Addon.db.profile.Frame.Style='minimal' -- the small window, not the subtitles a first install shows
SpokenEnv.SoundUtils={
  WhyInaudible=function() end, IsMutedByPlayer=function() return false end,
  PlaySound=function(_,clip) clip.handle=clip.id;return true end,
  StopSound=function(_,clip) clip.handle=nil end, MuteChannel=function() end,
}
SpokenEnv.Options={Open=function() end}
]], "settings and sound stubs")
for _, name in ipairs({ "Callbacks.lua", "SoundQueue.lua", "Sources.lua", "Strings.lua", "UI/Transcript.lua",
    "UI/Subtitle.lua", "UI/Portrait.lua", "UI/StaticPortrait.lua", "UI/Actions.lua", "UI/Snap.lua", "UI/Face.lua", "UI/PlayerFrame.lua",
    "UI/MinimalPlayer.lua", "UI/Ellesmere.lua", "UI/DialogueUITheme.lua", "UI/DialogueUIPlayer.lua", "UI/DialogueUITransitions.lua", "API.lua" }) do
    load(name)
end
SpokenEnv.PlayerFrame:Initialize()
run([[

local E=SpokenEnv
local P,Q,S=E.MinimalPlayer,E.SoundQueue,E.StaticPortrait
Q:RemoveAllSoundsFromQueue();Advance(.3)
local source={key="portraits",gates={},interClipGap=.25,GetChannel=function() return "Master" end}
local a="Creature-0-1-2-3-123-AAAA"
local b="Creature-0-1-2-3-456-BBBB"
local c="Creature-0-1-2-3-789-CCCC"
local function Clip(key,guid,id)
 return {key=key,path="test.ogg",length=20,unitGUID=guid,present={header=key,label=key,
   portrait={kind="model",creatureID=id,fallback={kind="texture",texture="Book"}}}}
end
MockUnits.npc=a;MockUnits.target=a
local first=Clip("NPC A",a,123);Q:Add(first,source)
local portraitA=P.viewport.activeFrame
assert(portraitA.nativeGUID==a and P.viewport.active=="static")
MockUnits.npc=b;MockUnits.target=b
local second=Clip("NPC B",b,456);Q:Add(second,source)
assert(S.cache[b] and S.cache[b].texture.nativeGUID==b)
MockUnits.npc=nil;MockUnits.target=c
S.watcher.scripts.OnEvent(S.watcher,"PLAYER_TARGET_CHANGED")
assert(P.viewport.activeFrame==portraitA and portraitA.nativeGUID==a)
Q:Skip()
assert(P.viewport.active=="static" and P.viewport.activeFrame.nativeGUID==b)
assert(not portraitA:IsShown())
Q:PauseQueue();Q:ResumeQueue()
assert(P.viewport.activeFrame.nativeGUID==b)
print("PASS: native static snapshots survive dialogue closure, target changes, queued-speaker changes and restart")

local portraitB=P.viewport.activeFrame
local calls=portraitB.nativeCalls
MockUnits.target=b
S.watcher.scripts.OnEvent(S.watcher,"UNIT_PORTRAIT_UPDATE","target")
assert(portraitB.nativeCalls==calls+1)
Q:RemoveAllSoundsFromQueue()
MockUnits.npc=nil;MockUnits.target=c
Q:Add(Clip("Unseen", "Creature-0-1-2-3-321-DDDD",321),source)
assert(P.viewport.active=="texture" and P.viewport.texture:GetTexture()=="Book")
assert(not portraitB:IsShown())
MockUnits.target="Creature-0-1-2-3-321-DDDD"
S.watcher.scripts.OnEvent(S.watcher,"PLAYER_TARGET_CHANGED")
assert(P.viewport.active=="static" and P.viewport.activeFrame.nativeGUID==MockUnits.target)
assert(getn(P.viewport.activeFrame.masks)==1)
Q:RemoveAllSoundsFromQueue()
-- Real GUIDs must never borrow another spawn's face even with the same creature ID.
MockUnits.target=b
Q:Add(Clip("Different spawn", "Creature-0-1-2-3-456-OTHER",456),source)
assert(P.viewport.active=="texture")
Q:RemoveAllSoundsFromQueue()
MockUnits.target=nil
Q:Add(Clip("Quest log", "Creature-0-0-0-0-456-000000",456),source)
assert(P.viewport.active=="static" and P.viewport.activeFrame.nativeGUID==b)
print("PASS: appearance-load refresh, honest unseen-speaker fallback, later native capture and exact-GUID matching")

-- A quest-log giver never met this session: no unit to photograph, so the face is drawn from
-- the creature's appearance, and a creature the client has not cached yet is asked again.
Q:RemoveAllSoundsFromQueue()
MockUnits.npc=nil;MockUnits.target=nil
MockDisplays[654]=9001
Q:Add(Clip("Unmet giver","Creature-0-0-0-0-654-000000",654),source)
assert(P.viewport.active=="static" and P.viewport.activeFrame.nativeDisplay==9001)
assert(getn(P.viewport.activeFrame.masks)==1)
Q:RemoveAllSoundsFromQueue()
Q:Add(Clip("Uncached giver","Creature-0-0-0-0-655-000000",655),source)
assert(P.viewport.active=="texture" and P.viewport.texture:GetTexture()=="Book")
MockDisplays[655]=9002;Advance(.06)
assert(P.viewport.active=="static" and P.viewport.activeFrame.nativeDisplay==9002)
Q:RemoveAllSoundsFromQueue()
Q:Add(Clip("Never cached","Creature-0-0-0-0-656-000000",656),source)
for i=1,200 do Advance(.05) end
assert(P.viewport.active=="texture" and P.viewport.texture:GetTexture()=="Book")
-- A real speaker still never borrows a face drawn from the creature id.
Q:RemoveAllSoundsFromQueue()
Q:Add(Clip("Real spawn","Creature-0-1-2-3-654-REAL",654),source)
assert(P.viewport.active=="texture")
print("PASS: unmet quest-log giver drawn from its creature appearance, uncached creature retried, then the book")

Q:RemoveAllSoundsFromQueue();Advance(.3)
for i=1,48 do
 local guid="Creature-0-1-2-3-"..(1000+i).."-TEST"
 MockUnits.npc=guid
 S:Capture(Clip("Cached "..i,guid,1000+i))
end
local entries=0;for _ in pairs(S.cache) do entries=entries+1 end
assert(S.count==32 and entries==32)
assert(P.badgeBackground.color[4]==1 and P.badgeBackground:GetWidth()==24)
local bg,icon=P.badgeBackground.points[1],P.badge.points[1]
assert(bg[4]==icon[4] and bg[5]==icon[5])
local badges={["quest-accept"]="MinimalBulletAccept",gossip="MinimalBulletGossip",book="TrainerGossipIcon",zone="UI%-World%-Icon"}
for id,texture in pairs(badges) do
 P.clip.present.bullet=id;P:ConfigurePortrait()
 assert(P.badge:IsShown() and P.badge.texture:find(texture),id)
end
P.clip.present.bullet=nil;P:ConfigurePortrait()
-- No badge, no dark disc where it would sit.
assert(not P.badge:IsShown() and not P.badgeBackground:IsShown())
-- The subtitles' face waits for an uncached creature as the window's does: the book, then its face.
local T=E.Subtitle
T:Build()
local uncached=Clip("Subtitle giver","Creature-0-0-0-0-657-000000",657)
T.wanted,T.clip=true,uncached
T:ConfigurePicture(uncached)
assert(T.viewport.active=="texture" and T.viewport.texture:GetTexture()=="Book")
assert(not T.badge:IsShown() and not T.picture.badgeBackground:IsShown())
MockDisplays[657]=9003;Advance(.06);T:Tick(.06)
assert(T.viewport.active=="static" and T.viewport.activeFrame.nativeDisplay==9003)
T.wanted,T.clip=nil,nil
assert(getn(E.Callbacks.errors)==0,table.concat(E.Callbacks.errors,"\n"))
print("PASS: quest, gossip, book and zone badges, no disc without one, bounded portrait cache, opaque centred badge, the subtitles' face")
]], "portraits")

-- The textures it draws are power-of-two RGBA TGAs: 32 bits a pixel, the alpha the masks need.
local textures = 0
list = assert(io.popen('git -C "' .. ROOT .. '" ls-files -- "addons/Spoken/Textures/Minimal*.tga"'))
for path in list:lines() do
    local header = read(ROOT .. path):sub(1, 18)
    local width = header:byte(13) + header:byte(14) * 256
    local height = header:byte(15) + header:byte(16) * 256
    local function pow2(n) return n > 0 and bit.band(n, n - 1) == 0 end
    assert(pow2(width) and pow2(height), path .. " is " .. width .. "x" .. height)
    assert(header:byte(17) == 32, path .. " is not RGBA")
    textures = textures + 1
end
list:close()
assert(textures > 0, "git ls-files listed no Minimal*.tga")
print("PASS: all " .. textures .. " Minimal*.tga textures are power-of-two RGBA")
