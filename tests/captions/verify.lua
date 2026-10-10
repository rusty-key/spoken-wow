-- Offline integration checks: real Spoken queue, sources, callbacks, transcript,
-- layout and quest adapter, with a small WoW widget/timer host.
local clock, timers, nextTimer = 0, {}, 0
format, getn, strlower = string.format, table.getn, string.lower
strtrim = function(s) return (s:gsub('^%s+', ''):gsub('%s+$', '')) end
GetTime = function() return clock end
UnitName = function() return 'Test' end
GetRealmName = function() return 'Realm' end
SlashCmdList = {}
GameFontNormal = { GetFont = function() return 'font.ttf', 14 end }

local here = arg[0]:match("^(.*)/[^/]*$") or "."
local addons = here .. "/../../addons/"
dofile(here .. '/fixture.lua')
local function Copy(v)
    if type(v)~='table' then return v end
    local t={}; for k,value in pairs(v) do t[k]=Copy(value) end; return t
end
local Timer = {}
function Timer:ScheduleTimer(fn, delay)
    nextTimer=nextTimer+1; timers[nextTimer]={fn=fn,at=clock+delay}; return nextTimer
end
function Timer:ScheduleRepeatingTimer(fn, delay)
    local id=self:ScheduleTimer(fn,delay); timers[id].interval=delay; return id
end
function Timer:CancelTimer(id) timers[id]=nil end
LibStub=function(name)
    if name=='AceTimer-3.0' then
        return { Embed=function(_,obj) for k,v in pairs(Timer) do obj[k]=v end; return obj end }
    end
    assert(name=='AceDB-3.0')
    return { New=function(_,_,defaults) local db=Copy(defaults); db.global={}; return db end }
end

dofile(addons .. 'Spoken/Environment.lua')
local E=SpokenEnv
E.Version={IsLegacyVanilla=false,IsLegacyBurningCrusade=false,IsLegacyWrath=false,
    IsCamelot=true,IsAnyLegacy=false,IsRetailOrAboveLegacyVersion=function() return true end}
dofile(addons .. 'Spoken/Core.lua')
dofile(addons .. 'Spoken/Callbacks.lua')
dofile(addons .. 'Spoken/SoundQueue.lua')
dofile(addons .. 'Spoken/Sources.lua')
dofile(addons .. 'Spoken/Developer.lua')
dofile(addons .. 'Spoken/Strings.lua')
dofile(addons .. 'Spoken/UI/Layout.lua')
dofile(addons .. 'Spoken/UI/DialogueUITheme.lua')
dofile(addons .. 'Spoken/UI/Transcript.lua')
-- The status bar art the subtitle's progress bar is framed with, as a modern client describes it.
C_Texture=C_Texture or {}
C_Texture.GetAtlasInfo=C_Texture.GetAtlasInfo or function(name)
    -- As the client does: it finds Vector2DMixin in the caller's environment, so a call from
    -- Spoken's private one fails.
    if getfenv(2)~=_G then error('unable to find mixin or metatable (Vector2DMixin)') end
    local sizes={['widgetstatusbar-borderleft']={35,31},['widgetstatusbar-borderright']={35,31},
        ['widgetstatusbar-bordercenter']={64,31},['widgetstatusbar-bgcenter']={64,18},['widgetstatusbar-fill-yellow']={256,15}}
    local s=sizes[name]
    return s and {width=s[1],height=s[2],file=0,leftTexCoord=0,rightTexCoord=1,topTexCoord=0,bottomTexCoord=1} or nil
end
dofile(addons .. 'Spoken/UI/Subtitle.lua')
E.SoundUtils={WhyInaudible=function() end,IsMutedByPlayer=function() return false end,
    MuteChannel=function() end,TestSound=function() return true end,
    PlaySound=function(_,clip) if clip.path=='missing' then return false end; clip.handle=1; return true end,
    StopSound=function(_,clip) clip.handle=nil end}
E.StaticPortrait={Configure=function() return false end,Resolved=function() return false end}
E.Portrait={Configure=function(_,frame) frame.active='mock-model' end}
dofile(addons .. 'Spoken/UI/Actions.lua')
dofile(addons .. 'Spoken/UI/PlayerFrame.lua')
dofile(addons .. 'Spoken/UI/MinimalPlayer.lua')
dofile(addons .. 'Spoken/UI/DialogueUIPlayer.lua')
E.Minimap={Setup=function() end}; E.Options={Setup=function() end}
-- The windows first, with the word lit: the subtitles a first install shows are switched to
-- below, and the defaults themselves are pinned in defaults_test.
E.Addon:InitDB()
E.Addon.db.profile.Frame.Style='minimal'
E.Addon.db.profile.Audio.LineGap=0
E.Addon.db.profile.Transcript.HighlightWord=true
E.Addon:Enable()
local T,Q,M=E.Transcript,E.SoundQueue,E.MinimalPlayer
local source=E.Sources:Register('quests',{interClipGap=.55})
local cfg=E.Addon.db.profile.Transcript
-- The checks up to the scroll-mode section expect page-by-page following.
cfg.ScrollMode='page'

local assertions=0
local function Check(v,message) assertions=assertions+1; assert(v,message) end
local function Advance(seconds)
    local target=clock+seconds
    while true do
        local earliest,id
        for k,t in pairs(timers) do if t.at<=target and (not earliest or t.at<earliest) then earliest,id=t.at,k end end
        if not id then break end
        clock=earliest
        local t=timers[id]
        if t.interval then t.at=clock+t.interval else timers[id]=nil end
        t.fn()
    end
    clock=target
    T:Update()
    M:Tick(seconds)
end
local function Clip(key,text,length)
    return {key=key,path=key,length=length or 60,text=text,
        present={header='NPC '..key,label='Quest '..key}}
end
local function Plain(text) return text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|r','') end
local function Captions()
    local lines={}
    for _,label in ipairs(T.labels) do if label:IsShown() then lines[#lines+1]=label:GetText() end end
    return table.concat(lines,'\n'),#lines
end
local function HighlightCount()
    local text=Captions()
    local _,count=text:gsub('|cffffd100','')
    return count
end
local function CheckLayout()
    local _,count=Captions()
    Check(count<=(E.Addon:Layout().CaptionsExpanded and 8 or cfg.Lines),'only the requested number of lines is visible')
    for _,label in ipairs(T.labels) do
        if label:IsShown() then
            Check(not label.wordWrap and not label:GetText():find('\n'),'each caption label is exactly one non-wrapping line')
            Check(label:GetStringWidth()<=label:GetWidth(),'rendered text fits the available width')
        end
    end
end
local long=string.rep('A long line about the quest and the world. ',55)
local initialTop=M.frame:GetTop()
local a,b=Clip('a',long),Clip('b','Second quest text',20)
-- The highlight on its own first; the window types its words out too, checked below.
cfg.Typewriter=false; T:RefreshConfig()
source:Enqueue(a); source:Enqueue(b)
Check(T.frame:IsShown(),'transcript appears for a narrated quest')
Check(T.frame:GetParent()==M.frame and T.frame:IsVisible(),'captions belong to the visible portrait player')
Check(math.abs(M.frame:GetTop()-initialTop)<.001,'adding captions preserves the portrait position')
Check(T.frame:GetTop()<M.bar:GetBottom(),'captions sit below the existing progress bar')
Check(T.frame:GetBottom()>M.panel:GetBottom(),'caption text fits inside the existing stone panel')
Check(T.frame:GetLeft()==M.content:GetLeft(),'captions align with the player name and title')
Check(not T.frame.backdrop and not T.speaker and not T.status,'captions have no independent window chrome')
Check(T.labels[1].textColor[1]==M.title.text.textColor[1] and T.labels[1].shadowOffset[1]==1,'captions use the player text palette and shadow')
Check(T.text==long:sub(1,-2),'first text is retained while another NPC is queued')
Check(M.name:GetText()=='NPC a','speaker belongs to the current clip')
Check(cfg.Lines==2 and T.frame:GetHeight()<160,'default panel is compact with two caption lines')
Check(T.activeWord==1 and HighlightCount()==2,'first two words are highlighted at the start')
CheckLayout()
Advance(30)
Check(T:GetProgress()==.5,'progress follows real queue timing')
Check(T:Page()>1 and T.activeWord>1 and HighlightCount()>=1,'captions follow the highlighted word through the recording')
do
    -- Typed out, as the subtitle is: the page's words up to the one being read, the rest to come.
    local function Shown()
        local count=0
        for _,label in ipairs(T.labels) do
            if label:IsShown() then
                for _ in Plain(label:GetText()):gmatch('%S+') do count=count+1 end
            end
        end
        return count
    end
    local whole=Shown()
    cfg.Typewriter=true; T:RefreshConfig()
    local typed=Shown()
    Check(typed>0 and typed<whole,'the window types its words out as the voice reaches them')
    cfg.Typewriter=false; T:RefreshConfig()
end
CheckLayout()
T.frame:Fire('OnMouseWheel',1)
local manualPage=T:Page()
Advance(5)
Check(T.manualScroll and T:Page()==manualPage,'manual scrolling holds the chosen caption page')
T:Follow()
Check(not T.manualScroll and T:Page()>manualPage and HighlightCount()>=1,'Follow brings the active word back into view')
Q:PauseQueue()
local elapsed,pausedCaptions=T:GetElapsed(),Captions()
Advance(8)
Check(T:GetElapsed()==elapsed and Q:IsPaused(),'pause freezes time')
Check(Captions()==pausedCaptions,'pause freezes the word highlight and caption page')
Q:ResumeQueue()
Check(T:GetElapsed()==0 and T:Page()==1 and T.activeWord==1,'resume restarts captions with the actual restarted audio')
T:SetEnabled(false); Advance(10)
Check(not T.frame:IsShown() and Q:IsPlaying(a),'hiding captions leaves audio playing')
T:SetEnabled(true)
Check(T.frame:IsShown() and T:GetElapsed()==10 and HighlightCount()>=1,'reopening catches up to current narration')
Q:Skip()
Check(T.clip==b and Plain(Captions())=='Second quest text','skip switches to the next queued clip')
Check(T:GetElapsed()==0 and T.activeWord==1,'new clip begins at its first word')
Check(Captions()=='|cffffd100Second|r |cffffd100quest|r text','current and next word are highlighted together')
Advance(19)
Check(Captions()=='Second |cffffd100quest|r |cffffd100text|r','the last visible word keeps its previous neighbor highlighted')
Advance(1.25)
Check(Q:IsEmpty() and not T.frame:IsShown(),'normal completion hides captions as the last voice ends')
Check(Captions()=='' and T.activeWord==nil,'queue exhaustion clears stale dialogue and highlighting')

-- Chinese has no spaces: each character is a word, punctuation stays with
-- the character before it and adds a pause, and no spaces are inserted.
local chinese=Clip('zh','你好，「勇士」。去吧Go!',10)
source:Enqueue(chinese)
Check(Captions()=='|cffffd100你|r|cffffd100好，|r「勇士」。去吧Go!','Chinese highlights one character at a time, without spaces')
local texts={}
for i,w in ipairs(T.words) do texts[i]=w.text end
Check(table.concat(texts,'|')=='你|好，|「勇|士」。|去|吧|Go!','Chinese splits into characters with attached punctuation')
Check(T.words[2].finish-T.words[2].start>T.words[1].finish-T.words[1].start
    and T.words[4].finish-T.words[4].start>T.words[2].finish-T.words[2].start,'。 pauses longer than ， and ， longer than none')
Advance(5)
Check(HighlightCount()==2 and Plain(Captions())=='你好，「勇士」。去吧Go!','highlight moves through Chinese text')
Q:RemoveAllSoundsFromQueue()

source:Enqueue(Clip('c',long,30)); Advance(12)
source:Enqueue(Clip('no-text',nil,5)); Q:Skip()
Check(not T.frame:IsShown() and Captions()=='','a clip without text never shows previous captions')
Q:RemoveAllSoundsFromQueue()
Check(not T.frame:IsShown(),'Stop clears captions')
source:Enqueue(Clip('d',long,60)); Advance(30)
local oldPages,word=T:PageCount(),T.activeWord
M.frame:SetWidth(700)
Check(T:PageCount()<oldPages,'widening the panel fits more words on each page')
Check(T.activeWord==word and HighlightCount()>=1,'resize keeps the current word visible')
cfg.FontSize=24; T:RefreshConfig()
Check(T.labels[1].fontSize==24 and T.labels[2].fontSize==24,'font-size setting applies to both lines')
Check(T.activeWord==word and HighlightCount()>=1,'font changes preserve the active word')
CheckLayout()
local twoLineHeight=T.frame:GetHeight()
SlashCmdList.SPOKEN('transcript 1')
Check(cfg.Lines==1 and select(2,Captions())==1,'one-line command shows just one caption line')
Check(T.frame:GetHeight()<twoLineHeight,'one-line mode shrinks the panel')
Check(T.activeWord==word and HighlightCount()>=1,'one-line mode still shows the active word')
CheckLayout()
SlashCmdList.SPOKEN('transcript 2')
Check(cfg.Lines==2 and T.frame:GetHeight()==twoLineHeight,'two-line command restores compact pair of lines')
Check(M.frame.bounds[2]==M.frame.bounds[4],'vertical resize is locked to the number of lines')
local compactTop, compactWord, compactElapsed = M.frame:GetTop(), T.activeWord, T:GetElapsed()
T.expand:Fire('OnClick')
Check(E.Addon:Layout().CaptionsExpanded and select(2,Captions())==8,'the plus button opens eight caption lines')
Check(T.frame:GetHeight()==twoLineHeight*4,'expanded captions grow inside the player')
Check(math.abs(M.frame:GetTop()-compactTop)<.001,'expanding leaves the portrait in place')
Check(T.activeWord==compactWord and T:GetElapsed()==compactElapsed,'expanding does not restart playback or its highlight')
Check(T.expand:GetLeft()>T.labels[1]:GetRight(),'the caption button has space beside the text')
CheckLayout()
T:TurnPage(1)
local firstVisible=(T:Page()-1)*8+1
T.expand:Fire('OnClick')
Check(not E.Addon:Layout().CaptionsExpanded and cfg.Lines==2 and T.frame:GetHeight()==twoLineHeight,'minus restores the compact preference')
Check(T.manualScroll and T:Page()==math.floor((firstVisible-1)/2)+1,'collapsing keeps the manually selected passage visible')
T:Follow()
cfg.HighlightWord=false; T:RefreshConfig()
Check(HighlightCount()==0 and T.activeWord==word,'highlight can be disabled while captions keep following')
cfg.HighlightWord=true; cfg.ScrollMode='off'; T:RefreshConfig()
local heldPage=T:Page()
Advance(3)
Check(T:Page()==heldPage,'disabling Follow keeps the chosen caption page')
T:Follow()
Check(T:Page()>heldPage and HighlightCount()>=1,'Follow re-enables automatic page changes')
Check(cfg.ScrollMode=='line','...in the default mode')
cfg.ScrollMode='page'
Q:RemoveAllSoundsFromQueue()

local held=true
source:AddGate(function() if held then return 'combat' end end)
source:Enqueue(Clip('held','Waiting for combat',8))
Advance(3)
Check(T:GetElapsed()==0 and not Q:IsPlaying(),'gated clips do not accrue speech time')
Check(HighlightCount()==0 and T.activeWord==nil,'waiting clips do not claim a word is being spoken')
held=false; Advance(1)
Check(Q:IsPlaying() and T:GetElapsed()==0 and T.activeWord==1,'gated clip begins highlighting only when audio starts')
Q:RemoveAllSoundsFromQueue()
local failed=Clip('failed','Not playable',10); failed.path='missing'
source:Enqueue(failed)
Check(not T.frame:IsShown(),'rejected audio leaves no stale captions')
local delayed=Clip('delayed',long,10); delayed.delay=2
source:Enqueue(delayed); Advance(1)
Check(T:GetProgress()==0 and HighlightCount()==0,'initial silence is excluded from highlighting')
Q:PauseQueue(); Advance(2)
Check(HighlightCount()==0,'pausing during initial silence does not highlight a word')
Q:ResumeQueue(); Advance(2)
Check(T.activeWord==1 and HighlightCount()>=1,'first word appears when initial silence ends')
Advance(5)
Check(T:GetProgress()==.5 and HighlightCount()>=1,'duration starts after the delay')
SlashCmdList.SPOKEN('transcript off')
Check(not cfg.Enabled,'slash command disables captions')
SlashCmdList.SPOKEN('transcript on')
Check(cfg.Enabled,'slash command enables captions')
SlashCmdList.SPOKEN('stop')
Check(not T.frame:IsShown(),'slash stop clears display')
Check(T:CleanText('|cffff0000Hello|r |Hitem:1|h[sword]|h|n|Ticon:16|tWorld')=='Hello [sword]\nWorld','markup is normalized without losing visible text')
Check(T:CleanText('Привет 世界')=='Привет 世界','UTF-8 text remains intact')

-- Exercise the actual player layouts: docking, queue expansion, scale, visibility,
-- original-skin fallback and controls. All coordinates are in player UI units.
source:Enqueue(Clip('docking',long,120))
local frameCfg=E.Addon.db.profile.Frame
T:Reset()
do
    local d=E.Defaults.profile.Transcript
    Check(cfg.HighlightWord==d.HighlightWord and cfg.SubtitleShadow==d.SubtitleShadow and cfg.TypewriterBy==d.TypewriterBy,
        'resetting the words puts back the defaults a first install has')
end
-- The window checks below follow the word being read.
cfg.HighlightWord=true; T:RefreshConfig()
local playerTop=M.frame:GetTop()
local extra={}
for i=1,6 do extra[i]=Clip('extra'..i,'Later dialogue',10); source:Enqueue(extra[i]) end
M:ToggleQueue()
Check(M.drawer:IsShown() and M.queueNote:IsShown(),'expanded queue still displays rows and its paging note')
Check(M.drawer:GetTop()<T.frame:GetBottom(),'downward queue drawer cannot overlap captions')
T.expand:Fire('OnClick')
Check(M.drawer:GetTop()<T.frame:GetBottom() or M.drawer:GetBottom()>T.frame:GetTop(),
    'the open queue stays clear of expanded captions, including when it flips upward')
Check(T.frame:GetBottom()>M.panel:GetBottom(),'the panel encloses expanded captions and queue')
T.expand:Fire('OnClick')
Check(M.panel:GetBottom()<M.drawer:GetBottom(),'the shared background encloses the expanded queue')
Check(math.abs(M.frame:GetTop()-playerTop)<.001,'opening the queue leaves the unit icon in place')
local anchor={M.frame:GetPoint(1)}
M.frame:ClearAllPoints(); M.frame:SetPoint('BOTTOM',UIParent,'BOTTOM',0,20)
M:LayoutQueue()
Check(M.drawer:GetBottom()>M.header:GetTop(),'near the bottom of the screen the queue opens above the speaker name')
Check(T.frame:GetTop()<M.bar:GetBottom(),'queue opening upwards leaves captions beneath the progress bar')
M.frame:ClearAllPoints(); M.frame:SetPoint(unpack(anchor))
for _,clip in ipairs(extra) do source:Remove(clip) end
M:ToggleQueue()
frameCfg.HidePortrait=true; E.PlayerFrame:RefreshConfig()
Check(not M.portrait:IsShown() and math.abs(T.frame:GetLeft()-M.content:GetLeft())<.001,'hide-portrait mode keeps captions aligned')
frameCfg.HidePortrait=false; frameCfg.FrameScale=1.1; E.PlayerFrame:RefreshConfig()
Check(T.frame:GetEffectiveScale()==M.frame:GetEffectiveScale(),'captions inherit the player scale')
Check(M.portrait:IsShown() and T.frame:GetLeft()>M.portrait:GetLeft(),'restored portrait remains beside the caption text')
frameCfg.Style='none'; E.PlayerFrame:RefreshConfig()
Check(not T.frame:IsVisible() and Q:IsPlaying(),'hiding the player hides its captions while audio continues')
frameCfg.Style='minimal'; E.PlayerFrame:RefreshConfig()
Check(T.frame:IsVisible(),'showing the player restores its attached captions')
local movedTop=M.frame:GetTop()
T:SetEnabled(false)
Check(M.frame:GetHeight()==98 and M.frame:IsShown(),'disabling captions restores the original compact player height')
Check(math.abs(M.frame:GetTop()-movedTop)<.001,'removing captions keeps the portrait in place')
T:SetEnabled(true)
Check(math.abs(M.frame:GetTop()-movedTop)<.001,'restoring captions keeps the portrait in place')
T:TurnPage(-1); T.frame:Fire('OnClick','LeftButton')
Check(not T.manualScroll,'clicking the caption text resumes following')
T.frame:Fire('OnClick','RightButton')
Check(M.menu:IsShown(),'right-clicking captions opens the existing player menu')
M.menu:Hide()
frameCfg.LockFrame=true; E.PlayerFrame:RefreshConfig(); M:StartDrag()
Check(not M.frame.moving and not M.resizer:IsShown(),'the player lock controls the attached caption layout')
frameCfg.LockFrame=false; E.PlayerFrame:RefreshConfig(); M.header:Fire('OnDragStart')
Check(M.frame.moving,'the existing header still moves the whole player')
M.header:Fire('OnDragStop')
frameCfg.Style='classic'; E.PlayerFrame:RefreshConfig()
local original=E.PlayerFrame.frame
Check(T.frame:GetParent()==original and original:IsShown() and not M.frame:IsShown(),'switching skins attaches captions to the original player')
Check(T.frame:GetTop()<original.portrait:GetBottom(),'original-skin captions stay below portrait and action controls')
Check(T.frame:GetBottom()>original.background:GetBottom(),'original background extends behind the captions')
local originalTop=original:GetTop()
T.expand:Fire('OnClick')
Check(select(2,Captions())==8 and T.frame:GetBottom()>original.background:GetBottom(),'the floating-head layout encloses expanded captions')
Check(math.abs(original:GetTop()-originalTop)<.001,'expanding preserves the floating head position')
T.expand:Fire('OnClick')
local previousWidth=T.frame:GetWidth()
original:SetWidth(620)
Check(T.frame:GetWidth()>previousWidth,'resizing the original player reflows the attached text')
CheckLayout()
frameCfg.Style='minimal'; frameCfg.FrameScale=.7; E.PlayerFrame:RefreshConfig()
Check(T.frame:GetParent()==M.frame and not original:IsShown(),'switching back restores attachment to the portrait player')
for _,point in ipairs({'TOPLEFT','CENTER','BOTTOM'}) do
    M.frame:ClearAllPoints(); M.frame:SetPoint(point,UIParent,point,0,200)
    local top=M.frame:GetTop()
    cfg.Lines=1; T:RefreshConfig()
    Check(math.abs(M.frame:GetTop()-top)<.001,'one-line mode preserves '..point..' portrait position')
    cfg.Lines=2; T:RefreshConfig()
    Check(math.abs(M.frame:GetTop()-top)<.001,'two-line mode preserves '..point..' portrait position')
    T:ToggleExpanded()
    Check(math.abs(M.frame:GetTop()-top)<.001,'expanded mode preserves '..point..' portrait position')
    T:ToggleExpanded()
end
Q:RemoveAllSoundsFromQueue()

-- Compare every displayed page to the original text; resizing must neither lose
-- nor duplicate characters, including long names and text without spaces.
local multilingual='Welcome, Windbeard!\nПривет путник. '..string.rep('世界',60)..' '..string.rep('W',90)..' The end.'
-- Every word on the page, not typed out: this is about wrapping, not timing.
cfg.Typewriter=false
cfg.ScrollMode='page' -- the check below turns pages by hand
source:Enqueue(Clip('unicode',multilingual,120))
for _,size in ipairs({12,26}) do
    for _,width in ipairs({300,900}) do
        for _,count in ipairs({1,2,8}) do
            cfg.FontSize,cfg.Lines,E.Addon:Layout().CaptionsExpanded=size,count==1 and 1 or 2,count==8
            M.frame:SetWidth(width); T:RefreshConfig()
                        local displayed={}
            for page=1,T:PageCount() do
                T:ScrollTo((page-1)*count+1)
                CheckLayout()
                displayed[#displayed+1]=Plain(Captions())
            end
            local joined=table.concat(displayed):gsub('%s','')
            Check(joined==multilingual:gsub('%s',''),'every source character survives wrapping and paging')
        end
    end
end
-- Sample playback through split UTF-8 words and page boundaries in one-line mode.
E.Addon:Layout().CaptionsExpanded=false; cfg.Lines=1; T:RefreshConfig()
T:Follow()
for sample=1,100 do
    Advance(1)
    Check(HighlightCount()>=1,'the current word remains highlighted throughout speech')
    CheckLayout()
end
Q:RemoveAllSoundsFromQueue()
local unknown=Clip('unknown','Words without a usable duration',0)
source:Enqueue(unknown)
Check(T.frame:IsShown() and HighlightCount()==0,'unusable timing shows text without a fabricated highlight')
Q:RemoveAllSoundsFromQueue()
local override=Clip('override','Fallback text',10); override.present.transcript='Display this instead'
source:Enqueue(override)
Check(T.text=='Display this instead','explicit source transcript takes precedence')
Q:RemoveAllSoundsFromQueue()

-- Scroll modes: line by line glides to keep the line being read in the middle.
E.Addon:Layout().CaptionsExpanded=true; cfg.ScrollMode='line'; T:RefreshConfig()
source:Enqueue(Clip('scroll',long,60))
local function Settle() T.frame:Fire('OnUpdate',1) end
local function ActiveLine() return T:ActiveSegment(T:GetProgress()).line end
Advance(20); Settle()
Check(T.topTarget==ActiveLine()-3,'line by line keeps the line being read fourth of eight')
local settled=T.top
Advance(1.5)
local target=T.topTarget
Check(target>settled,'the next line moves the target')
T.frame:Fire('OnUpdate',.03)
Check(T.top>settled and T.top<target,'the text glides part of the way, not a whole line at once')
local _,shown=Captions()
Check(shown==9,'mid-glide the line sliding in shows under the page')
Settle()
Check(T.top==target,'and settles on the line')
local _,settledShown=Captions()
Check(settledShown==8,'with the page back to its eight lines')
cfg.Typewriter=true; T:Update(); Settle()
Check(T.topTarget==ActiveLine()-7,'typed out, the line being read is the last of eight')
local typed=Captions()
Check(not typed:find('\n\n') and typed:sub(-1)~='\n','with no blank row under it')
cfg.Typewriter=false
cfg.ScrollMode='line'; T:Update()
T.frame:Fire('OnMouseWheel',1)
Check(T.manualScroll and T.topTarget<target,'the wheel scrolls back by lines, holding there')
T:ScrollTo(1)
Check(T.top==1 and T.manualScroll,'a scrollbar drag lands at once')
T:Follow()
Check(not T.manualScroll,'clicking the captions follows the voice again')
Q:RemoveAllSoundsFromQueue()
E.Addon:Layout().CaptionsExpanded=false; T:RefreshConfig()

-- The subtitle player: no window, just the words in a centred frame of their own, typed in
-- at the voice's pace. The client runs OnUpdate only on shown frames, and so does Play.
local S=E.Subtitle
cfg.Typewriter=true
cfg.FontSize,cfg.Lines=16,2
E.Addon:SetPlayerStyle('subtitle'); E.PlayerFrame:RefreshConfig(); T:RefreshConfig()
local cursor={0,0}
GetCursorPosition=function() return cursor[1],cursor[2] end
local function Click(dragBy)
    S.frame:Fire('OnMouseDown','LeftButton')
    cursor[1]=dragBy or 0
    S.frame:Fire('OnMouseUp','LeftButton')
    cursor[1]=0
end
local function Play(seconds)
    local steps=math.max(1,math.floor(seconds/.05+.5))
    for _=1,steps do
        Advance(seconds/steps)
        if S.frame and S.frame:IsShown() then S.frame:Fire('OnUpdate',seconds/steps) end
    end
end
local function RowShown(i) return S.lines[i]:GetText() or '' end
local function Typed()
    local parts={}
    for i in ipairs(S.rows or {}) do
        local shown=RowShown(i)
        if shown~='' then parts[#parts+1]=Plain(shown) end
    end
    return table.concat(parts,' ')
end
-- Whether any subtitle row has a word lit.
local function SubtitleLit()
    for i in ipairs(S.rows or {}) do if RowShown(i):find('|c',1,true) then return true end end
    return false
end
local line='Hello there, traveller. The road ahead is long and the night is cold.'
source:Enqueue(Clip('sub',line,20))
Check(not T.frame:IsShown() and not M.frame:IsShown() and not E.PlayerFrame.frame:IsShown(),
    'subtitles take the place of both windows')
Check(S.frame:IsShown() and S.frame:GetParent()==UIParent,'the subtitle is a frame of its own')
Check(S.frame:GetFrameStrata()=='LOW','...drawn under the panels of the game, so a window opened over it covers it')
Check(S.title:GetText()=='NPC sub','the speaker names the subtitle')
-- The speaker's picture before the name, and what the line belongs to in grey after it.
Check(S.picture:IsShown() and S.viewport.active~=nil,"the subtitle shows the speaker's picture")
do
    local _,_,_,pictureX=S.picture:GetPoint(1)
    local _,_,_,nameX=S.title:GetPoint(1)
    Check(pictureX<nameX,'...before the name')
end
Check(S.dot:GetText()=='•' and select(2,S.dot:GetPoint(1))==S.title,'a dot follows the name')
Check(S.label:GetText()=='Quest sub' and select(2,S.label:GetPoint(1))==S.dot,"...and the quest's title the dot")
Check(S.frame:GetAlpha()==0 and Typed():gsub('%s','')=='','a new line fades in and types from nothing')
Check(math.abs(S.frame:GetCenter()-UIParent:GetWidth()/2)<.001,'the subtitle is centred until moved')
Play(1)
Check(S.frame:GetAlpha()==1,'the fade-in completes')
-- Spoken Subtitles' progress line under the words, and the buttons in a row under the subtitle.
Check(not S.progressBroken and S.progressHeight==7 and S.fill.atlas=='widgetstatusbar-fill-yellow',"the progress bar is built in the game's status bar frame")
Check(S.track:IsShown() and S.fill:GetWidth()>0.01 and S.fill:GetWidth()<S.track:GetWidth(),'the progress line fills as the line is read')
Check(math.abs(S.track:GetWidth()-math.floor(S.shadowWant.w*.45))<1,'...across 45% of the background, as Spoken Subtitles draws it')
do
    -- The words as far under the name as the bar is under the words.
    local nameToWords=S:RowHeight()-S.title:GetStringHeight()
    nameToWords=math.floor(nameToWords/2)+8
    Check(S.progressGap==nameToWords,'the bar sits as far under the words as the words sit under the name')
end
do
    local point,relativeTo,relativePoint=S.controls:GetPoint(1)
    Check(point=='TOP' and relativeTo==S.shadow and relativePoint=='BOTTOM','the buttons sit in a row under the background, easing with it')
    local tall=S.frame:GetHeight()
    cfg.SubtitleProgress=false; S:Update()
    Check(not S.track:IsShown() and S.frame:GetHeight()<tall,'turned off, the progress line goes and the subtitle closes up')
    cfg.SubtitleProgress=true; S:Update()
end
local partial=Typed()
Check(partial~='' and partial~=line and line:find(partial,1,true)==1,'the typewriter has revealed the start of the line')
Check(cfg.TypewriterBy=='letter','by default it types letter by letter')
Check(cfg.HighlightWord and not SubtitleLit(),'the subtitle lights no word, even with Highlight Words on: only the windows do')
do
    cfg.TypewriterBy='word'; S.revealed=nil; S:Render()
    local byWord=Typed()
    Check(byWord==line or line:find(byWord..' ',1,true)==1,'by word, each word shows whole as the typing reaches it')
    cfg.TypewriterBy='letter'; S.revealed=nil; S:Render()
end
for _,row in ipairs(S.rows) do Check(S:Width(row.text)<=480,'every subtitle line fits inside the padding') end
Q:PauseQueue(); Play(2)
Check(Typed()==partial,'pausing holds the typing where the voice stopped')
Check(S.pausedLabel:GetAlpha()==1 and S.label:GetAlpha()==0,"paused, (paused) takes the title's place after the name")
Check(S.rowLeft==S.rowWant and S.rowWant==-S:RowWidth(true)/2,'...and the row slides to its new middle')
Q:ResumeQueue()
Check(Typed():gsub('%s','')=='' and S.frame:GetAlpha()==1,'resuming types again from the start without fading again')
Play(.5)
Check(S.pausedLabel:GetAlpha()==0 and S.label:GetAlpha()==1,'...and the title comes back on resuming')
Play(9.7)
Check(Typed()==line,'the whole line is typed before the voice finishes')
cfg.Typewriter=false; T:RefreshConfig()
Check(Typed()==line,'without the typewriter the whole line shows at once')
cfg.Typewriter=true; T:RefreshConfig()
-- The corner Report icon the windows have, beside the subtitle, and gone with the setting
-- that hides it from the windows.
local reported={present={actions={{id='report',icon='bug',anchor='topright',label='Report'}}},source={key='quests'}}
S:Corner(reported)
Check(S.report~=nil and S.report:IsShown() and S.report:GetParent()==S.controls,'the subtitle shows the Report icon, with its other controls')
Check(S.report.glyph.texture=='bug','...the bug icon the line offers, in the same ring as pause')
local frameCfg=E.Addon.db.profile.Frame
frameCfg.HiddenActions=frameCfg.HiddenActions or {}
frameCfg.HiddenActions.report=true
S:Corner(reported)
Check(S.report==nil,'hiding the Report button hides it beside the subtitle too')
frameCfg.HiddenActions.report=nil
S:Corner(nil)
Click()
Check(not Q:IsPaused(),'clicking the words does nothing: they are too easily clicked by accident')
Check(not S.controls:IsShown(),'the controls are hidden until the pointer comes')
local saved=MouseIsOver
MouseIsOver=function(frame) return frame==S.frame end
Play(.05)
Check(S.controls:IsShown() and S.controls:GetAlpha()>0 and S.controls:GetAlpha()<1,'under the pointer they fade in')
Play(.2)
Check(S.controls:GetAlpha()==1,'...all the way')
S.pause:Fire('OnClick')
Play(.3)
Check(Q:IsPaused() and S.title:GetText()=='NPC sub' and S.pausedLabel:GetText()=='(Stopped)'
    and S.pausedLabel:GetAlpha()==1,'its Stop button stops the line, and "(Stopped)" fades in beside the title')
Check(S.pause.state=='replay','...and the button turns to Replay')
S.pause:Fire('OnClick')
Play(.05)
Check(not Q:IsPaused() and S.pausedLabel:GetAlpha()>0 and S.pausedLabel:GetAlpha()<1,'...and plays it again, the label fading out')
Check(S.skip~=nil and S.skip:GetParent()==S.controls,'beside it, a skip button, as the windows have')
MouseIsOver=saved
Play(.3)
Check(not S.controls:IsShown(),'once the pointer leaves they fade out, and go')

local centre=UIParent:GetWidth()/2
Check(math.abs(S.frame:GetTop()-336)<.001,'the subtitle starts at its default height')
S.frame:Fire('OnDragStart')
cursor[1],cursor[2]=300,80; S.frame:Fire('OnUpdate',.05)
Check(math.abs(S.frame:GetTop()-416)<.001 and math.abs(S.frame:GetCenter()-centre)<.001,
    'dragging moves the subtitle up with the cursor and never sideways')
cursor[2]=164; S.frame:Fire('OnDragStop'); cursor[1],cursor[2]=0,0
Check(math.abs(S.frame:GetTop()-500)<.001 and math.abs(S.frame:GetCenter()-centre)<.001
    and E.Addon:Layout().Subtitle.top==500,'a dragged subtitle stays at the height it was dropped, on the centre line')
S.frame:Fire('OnDragStart'); cursor[2]=5000; S.frame:Fire('OnDragStop'); cursor[2]=0
Check(math.abs(S.frame:GetTop()-UIParent:GetHeight())<.001,'it cannot be dragged off the top of the screen')
S:Reset(); E.Addon:Layout().Subtitle={top=500}; S:Place()
local droppedCenter=S.frame:GetCenter()
cfg.SubtitleScale=1.5; T:RefreshConfig()
Check(S.frame:GetScale()==1.5 and math.abs(S.frame:GetTop()*1.5-500)<.001
    and math.abs(S.frame:GetCenter()*1.5-droppedCenter)<.001,'a bigger subtitle stays where it was put')
cfg.SubtitleScale=1; T:RefreshConfig()
frameCfg.LockFrame=true; E.PlayerFrame:RefreshConfig()
S.frame:Fire('OnDragStart'); cursor[2]=100; S.frame:Fire('OnDragStop'); cursor[2]=0
Check(math.abs(S.frame:GetTop()-500)<.001,'locking the window locks the subtitle')
frameCfg.LockFrame=false; E.PlayerFrame:RefreshConfig()
source:Enqueue(Clip('short','Aye.',2)); Q:Skip()
Check(S.switching and S.title:GetText()~='NPC short','skipping fades the last line out first, as a line ending on its own does')
Play(.55)
Check(S.title:GetText()=='NPC short' and S.wanted and S.frame:GetAlpha()<1,'...then the next fades in')
Check(math.abs(S.frame:GetCenter()-droppedCenter)<.001 and math.abs(S.frame:GetTop()-500)<.001,
    'a shorter line stays centred where the subtitle was put')
Q:RemoveAllSoundsFromQueue()
Check(S.frame:IsShown() and not S.wanted,'stopping fades the subtitle out')
Play(.6)
Check(not S.frame:IsShown(),'and then hides it')

local story=string.rep('A long line about the quest and the world. ',20)
source:Enqueue(Clip('story',story,40))
local most=0
for _,page in ipairs(S.pages) do most=math.max(most,#S:Wrap(page.text)) end
Check(#S.pages>2 and S.page==1 and most<=4,'a long text is split into pages of at most four lines')
local joined=''
for _,page in ipairs(S.pages) do joined=joined..page.text end
Check(joined:gsub('%s','')==T.text:gsub('%s',''),'the pages hold every character once')
Check(S.pages[1].text:sub(-1)=='.','the first page ends at a sentence')
-- The voice reaches the second page's first word: the page on screen fades out, then the next
-- fades in.
for _=1,600 do
    Play(.05)
    if (S.pageFade and S.pageFade.phase=='out') or S.page==2 then break end
end
Check(S.pageFade and S.pageFade.phase=='out' and S.page==1 and S.lines[1]:GetAlpha()<1,
    'reaching the next page, the page on screen fades out first')
Play(.2)
Check(S.page==2 and S.lines[1]:GetAlpha()<1,'...and then the next fades in')
Play(.3)
Check(S.page==2 and S.lines[1]:GetAlpha()==1 and #Typed()<#S.pages[2].text,
    'the second page replaces the first and types from its start')
Q:RemoveAllSoundsFromQueue(); Play(.6)
T:SetEnabled(false); source:Enqueue(Clip('off',line,10))
Check(not S.frame:IsShown(),'hiding captions hides subtitles too')
T:SetEnabled(true); Q:RemoveAllSoundsFromQueue(); Play(.6)
S:Reset()
Check(E.Addon:Layout().Subtitle==nil and math.abs(S.frame:GetCenter()-UIParent:GetWidth()/2)<.001,
    'resetting returns the subtitle to the centre')
S:ShowSample(true)
Check(S.frame:IsShown() and S.title:GetText()=='Sample subtitle' and Typed()==E.L.SUBTITLE_SAMPLE_TEXT,
    'the sample shows a whole subtitle with nothing playing')
source:Enqueue(Clip('real',line,10))
Check(not S:IsShowingSample() and S.title:GetText()=='NPC real','a real line takes the place of the sample')
Q:RemoveAllSoundsFromQueue(); Play(.6)
S:ShowSample(true); S:ShowSample(false); Play(.6)
Check(not S.frame:IsShown(),'hiding the sample hides the subtitle')

SlashCmdList.SPOKEN('player minimal')
Check(E.Addon:PlayerStyle()=='minimal' and frameCfg.Style=='minimal','the slash command picks the small window')
source:Enqueue(Clip('back',line,10))
Check(T.frame:IsShown() and not S.frame:IsShown() and M.frame:IsShown() and M.frame:GetHeight()>98,
    'the words return to the small window')
SlashCmdList.SPOKEN('player classic')
Check(E.PlayerFrame.frame:IsShown() and not M.frame:IsShown() and T.frame:GetParent()==E.PlayerFrame.frame,
    'the slash command picks the large window, with the words inside it')
SlashCmdList.SPOKEN('player subtitle')
Check(S.frame:IsShown() and not T.frame:IsShown() and not E.PlayerFrame.frame:IsShown(),
    'switching to subtitles mid-line hides the window and shows the line')
E.Addon:SetPlayerStyle('minimal'); E.PlayerFrame:RefreshConfig(); T:RefreshConfig()
Q:RemoveAllSoundsFromQueue()
Check(#E.Callbacks.errors==0,table.concat(E.Callbacks.errors,'\n'))

-- Exercise the actual quest adapter and log-text helper, including reward text.
dofile(addons .. 'Spoken_Quests/Environment.lua')
-- Player.lua names its report action at load time, so it needs the string table.
dofile(addons .. 'Spoken_Quests/Strings.lua')
VoiceOver.Version=E.Version
dofile(addons .. 'Spoken_Quests/Enums.lua')
dofile(addons .. 'Spoken_Quests/Contribute.lua')
dofile(addons .. 'Spoken_Quests/Player.lua')
local V=VoiceOver
C_QuestLog={GetLogIndexForQuestID=function(id) return id==33 and 7 or nil end}
GetQuestLogQuestText=function(index) assert(index==7); return 'Log description', 'Objectives' end
local logClip={event=V.Enums.SoundEvent.QuestAccept,questID=33,name='NPC',fileName='33-accept',filePath='voice.ogg'}
V.Player:Prepare(logClip)
Check(logClip.text=='Log description','quest-log replay captures the correct entry description')
local reward={event=V.Enums.SoundEvent.QuestComplete,questID=33,fileName='33-complete',filePath='voice.ogg'}
V.Player:Prepare(reward)
Check(reward.text==nil,'acceptance text is never substituted for a reward speech')
local snap={event=V.Enums.SoundEvent.QuestAccept,questID=33,text='Text from NPC',fileName='accept'}
V.Player:Prepare(snap)
Check(snap.text=='Text from NPC','captured NPC text is preserved')
GetQuestLogQuestText=function() error('client API unavailable') end
local unavailable={event=V.Enums.SoundEvent.QuestAccept,questID=33,fileName='accept'}
Check(pcall(V.Player.Prepare,V.Player,unavailable),'missing log APIs do not break playback')
-- A zone's own story names the zone once: centred on the picture and the name, with no dot, and
-- "(paused)" straight after the name.
do
    local zone={key='z',path='z',length=5,text='A zone.',present={header='Durotar',label='Durotar'}}
    S:Prepare(zone,'A zone.'); S.shownPaused=false; S:Layout('A zone.')
    local plain=S:RowWidth(false)
    Check(not S.dot:IsShown() and S.label:GetText()=='' and plain==36+8+S.title:GetStringWidth()
        and S.rowWant==-plain/2,"a zone's story names it once, centred, with no dot")
    Check(select(2,S.pausedLabel:GetPoint(1))==S.title,'...and (paused) follows its name')
end
-- Report goes with the subtitle as it fades out after the last line, not ahead of it.
do
    local style=E.Addon:PlayerStyle()
    E.Addon:SetPlayerStyle('subtitle'); E.PlayerFrame:RefreshConfig(); T:RefreshConfig()
    local rc=Clip('rep','Report me.',5)
    rc.present.actions={{id='report',icon='bug',anchor='topright',label='Report'}}
    source:Enqueue(rc); Play(.7)
    Check(S.report~=nil and S.report:IsShown(),'a line with Report shows the Report icon')
    Q:RemoveAllSoundsFromQueue()
    Check(not S.wanted and S.report~=nil and S.report:IsShown(),'...which stays while the subtitle fades out')
    Play(.6)
    Check(not S.reportButton:IsShown(),'...and goes once it has faded')
    E.Addon:SetPlayerStyle(style); E.PlayerFrame:RefreshConfig(); T:RefreshConfig()
end
-- The progress bar follows the background as it eases, holds where the voice left it as the
-- subtitle fades out, and the row counts what waits behind the line.
do
    local style=E.Addon:PlayerStyle()
    E.Addon:SetPlayerStyle('subtitle'); E.PlayerFrame:RefreshConfig(); T:RefreshConfig()
    source:Enqueue(Clip('pa','One two three four five six seven eight nine ten eleven twelve.',4))
    source:Enqueue(Clip('pb','Next.',2))
    source:Enqueue(Clip('pc','Last.',2))
    Play(.7)
    Check(S.waiting==2 and S.more:GetText()=='+2' and S.more:IsShown(),'lines waiting behind show "+2" on the row')
    local point,relativeTo=S.track:GetPoint(1)
    Check(point=='BOTTOM' and relativeTo==S.shadow,'the progress bar hangs from the background, so it eases with it')
    Check(math.abs(S.track:GetWidth()-math.floor(S.shadowSize.w*.45))<1,'...and is sized from its eased width')
    Q:Skip()
    local slid=false
    for _=1,24 do
        Play(.05)
        if S.wanted and S.rowLeft and S.rowWant and S.rowLeft~=S.rowWant then slid=true end
    end
    Check(S.waiting==1 and S.more:GetText()=='+1' and not slid,'after a skip the next line comes with its count in, the row not sliding')
    Q:Skip(); Play(1.2)
    Check(S.waiting==0 and not S.more:IsShown(),'with nothing waiting, no count')
    Play(1.2)
    local held=S.share
    Q:RemoveAllSoundsFromQueue(); Play(.1)
    Check(held>0 and S.share==held and not S.wanted,'when the line ends the bar holds where it was as the subtitle fades')
    Play(.6)
    E.Addon:SetPlayerStyle(style); E.PlayerFrame:RefreshConfig(); T:RefreshConfig()
end
-- Sentences at Once: the subtitle pages a long line into pages of that many sentences, 3 unless
-- the player sets 1 to 4, never more than four lines, and a change re-pages the line on screen.
do
    local style=E.Addon:PlayerStyle()
    E.Addon:SetPlayerStyle('subtitle'); E.PlayerFrame:RefreshConfig(); T:RefreshConfig()
    Check(cfg.SubtitleSentences==3,'Sentences at Once is 3 to begin with')
    local long=string.rep('A long sentence that keeps going on and on across the screen. ',8)
    source:Enqueue(Clip('lines',long,30)); Play(.7)
    Check(#S.rows<=4 and #S.pages>1,'a long line is paged, three sentences at most to a page')
    cfg.SubtitleSentences=1; S:Update(); Play(.1)
    Check(#S.rows==1 and S.pageSentences==1,'set to one, the line on screen is paged again a sentence at a time')
    cfg.SubtitleSentences=3; S:Update()
    Q:RemoveAllSoundsFromQueue(); Play(.6)
    E.Addon:SetPlayerStyle(style); E.PlayerFrame:RefreshConfig(); T:RefreshConfig()
end
-- A clip that knows when each word is spoken (present.timings) is followed by those times, not
-- the estimate; a list that does not fit the words is ignored.
do
    Q:RemoveAllSoundsFromQueue(); Play(.6)
    local function Timed(key,text,length,timings)
        local clip=Clip(key,text,length)
        clip.present.timings=timings
        return clip
    end
    -- Four words of one length: the estimate gives each about a second, the times a long last word.
    source:Enqueue(Timed('t1','aaaa bbbb cccc dddd',4,{0,.2,.4,.6})); Play(1)
    Check(T.timed and T.totalWeight==4,'a clip with its word times is timed against its length')
    Check(T:WordAt(T:GetProgress())==4,'...and a second in, the voice is on the word its times say')
    Q:RemoveAllSoundsFromQueue(); Play(.6)
    source:Enqueue(Timed('t2','aaaa bbbb cccc dddd',4,{0,.2,.4})); Play(1)
    Check(not T.timed and T:WordAt(T:GetProgress())<4,'times that do not match the words leave the estimate')
    Q:RemoveAllSoundsFromQueue(); Play(.6)
    source:Enqueue(Timed('t3','aaaa bbbb cccc dddd',4,{0,.5,.3,.6})); Play(.2)
    Check(not T.timed,'...as do times that go backwards')
    Q:RemoveAllSoundsFromQueue(); Play(.6)
    -- Subtitles Only: a page turns when the voice reaches its first word.
    local style=E.Addon:PlayerStyle()
    E.Addon:SetPlayerStyle('subtitle'); E.PlayerFrame:RefreshConfig(); T:RefreshConfig()
    cfg.SubtitleSentences=1
    local text=string.rep('A long sentence that keeps going on and on across the screen. ',4)
    local words=#E.Transcript:Split(text)
    local timings={}
    -- The second sentence starts late, after a pause the estimate cannot know about.
    for i=1,words do timings[i]=(i-1)*.1+(i>12 and 5 or 0) end
    source:Enqueue(Timed('t4',text,words*.1+6,timings)); Play(.7)
    Check(T.timed and #S.pages==4,'a timed line is paged a sentence at a time')
    Check(math.abs(S.pages[2].start-timings[13])<1e-9,"...and its second page turns at its first word's time")
    cfg.SubtitleSentences=3
    Q:RemoveAllSoundsFromQueue(); Play(.6)
    E.Addon:SetPlayerStyle(style); E.PlayerFrame:RefreshConfig(); T:RefreshConfig()
end
print(string.format('PASS: %d checks using the real queue, both player layouts, captions, commands and quest adapter.',assertions))
