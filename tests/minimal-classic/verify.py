from pathlib import Path
from PIL import Image
from lupa.lua51 import LuaRuntime

root=Path(__file__).parent
lua=LuaRuntime(unpack_returned_tuples=True)
addon=root.parents[1]/'addons'/'Spoken'
compile_lua=lua.eval('function(code,name) local f,e=loadstring(code,name); if not f then error(e) end;return true end')
files=list(addon.rglob('*.lua'))
for path in files: compile_lua(path.read_text(encoding='utf-8-sig'),str(path))
print('PASS: Lua 5.1 syntax for',len(files),'addon/library files')
lua.execute((root/'fixture.lua').read_text(encoding='utf-8'))
def load(name): lua.execute((addon/name).read_text(encoding='utf-8-sig'),name=name)
load('Environment.lua')
lua.execute('SpokenEnv.Version={IsAnyLegacy=false,IsLegacyVanilla=false,IsRetailVanilla=false,IsRetailOrAboveLegacyVersion=function() return true end}')
load('Core.lua')
lua.execute('''
SpokenEnv.Addon.db={profile=SpokenEnv.Defaults.profile,char={IsPaused=false},global={}}
SpokenEnv.Addon.db.profile.Audio.AutoToggleDialog=false
SpokenEnv.Addon.db.profile.Frame.Style='minimal' -- the small window, not the subtitles a first install shows
SpokenEnv.SoundUtils={
  WhyInaudible=function() end, IsMutedByPlayer=function() return false end,
  PlaySound=function(_,clip) clip.handle=clip.id;return true end,
  StopSound=function(_,clip) clip.handle=nil end, MuteChannel=function() end,
}
SpokenEnv.Options={Open=function() end}
''')
for name in ['Callbacks.lua','SoundQueue.lua','Sources.lua','Strings.lua','UI/Transcript.lua','UI/Subtitle.lua','UI/Portrait.lua','UI/StaticPortrait.lua','UI/Actions.lua','UI/PlayerFrame.lua','UI/MinimalPlayer.lua','UI/DialogueUITheme.lua','UI/DialogueUIPlayer.lua','API.lua']: load(name)
lua.execute('''
local E=SpokenEnv
local P,Q,A=E.MinimalPlayer,E.SoundQueue,E.Addon
local function near(a,b) assert(math.abs(a-b)<.001,tostring(a).." ~= "..tostring(b)) end
local source={key="test",gates={},interClipGap=.25,GetChannel=function() return "Master" end}
local clicked=0
local actions={
 {id="report",text="Report",onClick=function(clip) assert(clip==Q:GetCurrentSound());clicked=clicked+1 end},
 {id="gossip",anchor="header",onClick=function() error("header actions stay out of the menu") end},
 {id="bug",icon="bug-icon",label="Report a problem",anchor="topright",onClick=function(clip) assert(clip==Q:GetCurrentSound());clicked=clicked+1 end},
 {id="custom",create=function(parent)
    local b=CreateFrame("Button",nil,parent);b:SetSize(32,32)
    b:SetScript("OnClick",function(self) assert(self.seen==Q:GetCurrentSound());clicked=clicked+1 end)
    return b
  end,onClipChanged=function(clip,button) button.seen=clip end},
}
local function Clip(key,length,portrait)
 return {key=key,path="test.ogg",length=length or 20,present={header="Marshal McBride",label=key,
  actions=actions,portrait=portrait or {kind="model",creatureID=123}}}
end
E.PlayerFrame:Initialize()
assert(not P.frame:IsShown() and not E.PlayerFrame.frame:IsShown())
assert(Spoken:GetPlayerFrame()==P.frame)
local first=Clip("First")
Q:Add(first,source)
assert(P.frame:IsShown() and P.wanted and P.viewport.active=="static")
assert(P.viewport:GetWidth()==78 and not P.viewport.model)
Advance(5);near(P.bar:GetValue(),.25)
Q:PauseQueue();Advance(3);near(P.bar:GetValue(),.25)
assert(P.pause.wash:IsShown())
assert(P.pause:GetFrameLevel()<P.badge:GetParent():GetFrameLevel(),"badge must sit above the pause overlay")
Q:ResumeQueue();near(P.bar:GetValue(),0)
Advance(2);near(P.bar:GetValue(),.1)
print("PASS: real queue -> UI; timer-based progress; pause freezes; restart resets")

for i=1,7 do Q:Add(Clip("Waiting "..i),source) end
assert(P.fold:IsShown() and P.fold.icon.texture:find("Plus") and tostring(P.fold.count:GetText())=="7")
P.fold:Click();assert(P.drawer:IsShown() and P.rows[4]:IsShown() and P.fold.icon.texture:find("Minus"))
P.drawer.scripts.OnMouseWheel(P.drawer,-3)
assert(P.offset==3 and P.rows[1].clip.key=="Waiting 4")
P.rows[1].scripts.OnEnter(P.rows[1]);assert(P.rows[1].cross:IsShown() and P.rows[1].text.color[2]<.1)
P.rows[1].scripts.OnLeave(P.rows[1]);assert(not P.rows[1].cross:IsShown() and P.rows[1].text.color[2]>.5)
P.title.scripts.OnEnter(P.title);assert(P.title.cross:IsShown() and P.title.text.color[2]<.1)
P.title.scripts.OnLeave(P.title);assert(not P.title.cross:IsShown())
local before=Q:GetQueueSize();P.rows[1]:Click();assert(Q:GetQueueSize()==before-1)
assert(Q:GetCurrentSound()==first)
P.panel.scripts.OnSizeChanged(P.panel,300,200) -- the rock tiles on, never stretches
near(P.rock.texCoord[2]*256,286);near(P.rock.texCoord[4]*256,186)
P.frame.bottom=2;P:LayoutQueue()
assert(P.drawer.points[1][1]=="BOTTOMLEFT")
P.frame.bottom=200
P:ToggleMenu();assert(P.menu:IsShown())
local corner
for _,button in ipairs(P.frame.actions.buttons) do
 if button.action.id=="bug" then corner=button
 elseif button.action.anchor=="header" then assert(not button:IsShown())
 else assert(button:GetParent()==P.actionHost);button:Click() end
end
-- The corner Report icon stays on the frame, above the panel, and the name stops short of it.
assert(corner and corner:IsShown() and corner:GetParent()==P.content and corner.points[1][1]=="TOPRIGHT")
assert(P.name.points[#P.name.points][2]<0)
local row=P.actionRows[1]
assert(row:IsShown() and row.icon.texture=="bug-icon" and row.text:GetText()=="Report a problem" and not P.actionRows[2])
row:Click();assert(clicked==3 and not P.menu:IsShown())
corner:Click();assert(clicked==4)
-- "Hide report button" hides the frame icon and its menu row alike.
A.db.profile.Frame.HiddenActions={bug=true};P:ConfigureActions()
assert(not corner:IsShown() and not P.actionRows[1]:IsShown() and P.name.points[#P.name.points][2]==0)
A.db.profile.Frame.HiddenActions={};P:ConfigureActions()
assert(corner:IsShown() and P.actionRows[1]:IsShown())
P:ToggleMenu();assert(P.menu:IsShown())
Q:Skip();assert(not P.menu:IsShown())
local head,size=Q:GetCurrentSound(),Q:GetQueueSize()
P.title:Click();assert(Q:GetCurrentSound()~=head and Q:GetQueueSize()==size-1)
print("PASS: paginated queue, removal, title click skips the line, bottom-edge drop-up, original custom/source action handlers, corner Report icon and its hide setting, stale-menu closure")

A.db.profile.Frame.HidePortrait=true;E.PlayerFrame:RefreshConfig()
assert(not P.portrait:IsShown());near(P.frame:GetWidth(),300)
A.db.profile.Frame.HidePortrait=false;E.PlayerFrame:RefreshConfig()
assert(P.portrait:IsShown());near(P.frame:GetWidth(),380)
A.db.profile.Frame.Style='none';E.PlayerFrame:RefreshConfig()
assert(not P.frame:IsShown() and Q:IsPlaying())
Advance(4)
A.db.profile.Frame.Style='minimal';E.PlayerFrame:RefreshConfig()
near(P.bar:GetValue(),.2)
A.db.profile.Frame.LockFrame=true;P:StartDrag();assert(not P.frame.moving)
A.db.profile.Frame.LockFrame=false;P:StartDrag();assert(P.frame.moving)
P.frame:StopMovingOrSizing()
print("PASS: hidden portrait, audio-only mode, progress catch-up, movement lock")

A.db.profile.Frame.Style='classic';E.PlayerFrame:RefreshConfig()
assert(not P.frame:IsShown() and E.PlayerFrame.frame:IsShown())
assert(Spoken:GetPlayerFrame()==E.PlayerFrame.frame)
A.db.profile.Frame.Style='minimal';E.PlayerFrame:RefreshConfig()
assert(P.frame:IsShown() and not E.PlayerFrame.frame:IsShown())
P.frame.left=120;P.frame:SetWidth(450);P:StartDrag();P.frame.scripts.OnDragStop(P.frame)
local saved=A:Layout().Minimal
near(saved.left,120);near(saved.top,P.frame:GetTop());near(saved.width,450)
P.frame:SetWidth(380);A.db.profile.Frame.HidePortrait=true;E.PlayerFrame:RefreshConfig()
near(P.frame:GetWidth(),370) -- the saved width, not the profile's
A.db.profile.Frame.HidePortrait=false;E.PlayerFrame:RefreshConfig();near(P.frame:GetWidth(),450)
A.db.profile.Frame.MinimalWidth=600;P:Reset();near(P.frame:GetWidth(),380)
assert(A:Layout().Minimal==nil,"reset forgets the saved place")
Q:RemoveAllSoundsFromQueue();assert(not P.wanted)
Advance(.3);assert(not P.frame:IsShown())
print("PASS: original-layout fallback, public frame API, saved place and width, reset, fade-out to hidden")

local held=true
source.gates={function() if held then return "Combat" end end}
local gated=Clip("Held")
Q:Add(gated,source)
assert(not Q:IsPlaying() and string.find(P.title.text:GetText(),"Combat"))
near(P.bar:GetValue(),0)
held=false;Q:Advance();assert(Q:IsPlaying())
Q:RemoveAllSoundsFromQueue();source.gates={}
Q:Add(Clip("Book",20,{kind="texture",texture="Book"}),source)
assert(P.viewport.active=="texture" and getn(P.viewport.texture.masks)==1)
P:Update();assert(getn(P.viewport.texture.masks)==1)
Q:RemoveAllSoundsFromQueue()
Q:Add(Clip("Short",2),source);Advance(2.1);near(P.bar:GetValue(),1)
assert(Q:IsPlaying());Advance(.2);assert(Q:IsEmpty())
Q:Add(Clip("Zero",0),source);near(P.bar:GetValue(),0)
assert(getn(E.Callbacks.errors)==0,table.concat(E.Callbacks.errors,"\\n"))
print("PASS: combat gates, round texture fallback, gap clamping, zero-duration safety, no callback errors")
''')
lua.execute('''
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
P.expanded=false;P:LayoutQueue()
local top,bottom=P.panel.points[1],P.panel.points[2]
assert(top[4]==44 and top[5]==-6 and bottom[5]==10)
local cx,cy,r=90*35/71,4+90*34/71,90*30.5/71
for _,y in ipairs({6+4,98-10-4}) do
 assert((44+4-cx)^2+(y-cy)^2<r^2,"panel corner must be under the opaque portrait disc")
end
local badges={["quest-accept"]="MinimalBulletAccept",gossip="MinimalBulletGossip",book="TrainerGossipIcon",zone="UI%-World%-Icon"}
for id,texture in pairs(badges) do
 P.clip.present.bullet=id;P:ConfigurePortrait()
 assert(P.badge:IsShown() and P.badge.texture:find(texture),id)
end
P.clip.present.bullet=nil;P:ConfigurePortrait()
assert(not P.badge:IsShown() and P.badgeBackground:IsShown())
assert(getn(E.Callbacks.errors)==0,table.concat(E.Callbacks.errors,"\\n"))
print("PASS: quest, gossip, book and zone badges, bounded portrait cache, opaque centred badge, panel corners concealed inside portrait")
''')
# The Forever tint is read from Version as the file loads, so the Forever half reloads it.
lua.execute('''
local E=SpokenEnv
local function tint(P) return string.format("%.2f %.2f %.2f",unpack(P.panel.borderColor)).."|"..string.format("%.2f %.2f %.2f",unpack(P.ring.color)).."|"..string.format("%.2f %.2f %.2f",unpack(P.trim.color)) end
local white="1.00 1.00 1.00|1.00 1.00 1.00|1.00 1.00 1.00"
assert(tint(E.MinimalPlayer)==white,"another client keeps the metal's own colour: "..tint(E.MinimalPlayer))
E.Version.IsCamelot=true
''')
load('UI/MinimalPlayer.lua')
lua.execute('''
local E=SpokenEnv
local A=E.Addon
local function tint(P) return string.format("%.2f %.2f %.2f",unpack(P.panel.borderColor)).."|"..string.format("%.2f %.2f %.2f",unpack(P.ring.color)).."|"..string.format("%.2f %.2f %.2f",unpack(P.trim.color)) end
E.PlayerFrame:RefreshConfig()
local bronze="0.95 0.68 0.35|0.95 0.68 0.35|0.95 0.68 0.35"
assert(tint(E.MinimalPlayer)==bronze,"Forever tints the metal bronze: "..tint(E.MinimalPlayer))
A.db.profile.Frame.BronzeTint=false;E.PlayerFrame:RefreshConfig()
assert(tint(E.MinimalPlayer)=="1.00 1.00 1.00|1.00 1.00 1.00|1.00 1.00 1.00","the setting takes the tint off: "..tint(E.MinimalPlayer))
A.db.profile.Frame.BronzeTint=true;E.PlayerFrame:RefreshConfig()
assert(tint(E.MinimalPlayer)==bronze,"and puts it back")
E.Version.IsCamelot=nil
print("PASS: Forever bronze tint on border, bar trim and portrait ring, behind its setting; other clients untouched")
''')
for path in (addon/'Textures').glob('Minimal*.tga'):
    image=Image.open(path)
    assert all(n>0 and n&(n-1)==0 for n in image.size),(path,image.size)
    assert image.mode=='RGBA',(path,image.mode)
assert len(list((addon/'Textures').glob('Minimal*.tga'))) == 9
print('PASS: all nine power-of-two RGBA TGA assets')
