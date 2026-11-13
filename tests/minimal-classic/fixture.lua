-- Offline WoW UI/timer fixture. Queue, actions, portraits and both player UIs
-- under test are the repository's real Lua, not reimplementations.
getn = table.getn
-- The client's format takes positional arguments (%1$s), which the translated strings use;
-- stock Lua's does not. Reordered as tests/lua/wow_client_stub.lua does, then formatted plainly.
local plainFormat = string.format
string.format = function(fmt, ...)
    if type(fmt) ~= 'string' or not fmt:find('%%%d+%$') then return plainFormat(fmt, ...) end
    local args, ordered, n = { ... }, {}, 0
    local plain = fmt:gsub('%%(%d+)%$', function(index)
        n = n + 1
        ordered[n] = args[tonumber(index)]
        return '%'
    end)
    return plainFormat(plain, unpack(ordered, 1, n))
end
format = string.format
local methods = {}
local clock, timers, serial = 0, {}, 0
local all = {}
local function New(kind, name, parent)
    local frame = setmetatable({ kind=kind, parent=parent, children={}, scripts={}, points={},
        shown=true, alpha=1, width=0, height=0, level=parent and parent.level+1 or 0, enabled=true }, {__index=methods})
    if parent then table.insert(parent.children, frame) end
    if name then _G[name]=frame end
    table.insert(all,frame)
    return frame
end
function CreateFrame(kind,name,parent) return New(kind,name,parent) end
function CreateFont(name) return New('Font',name) end
function methods:GetParent() return self.parent end
function methods:SetParent(parent)
    if self.parent then for i,child in ipairs(self.parent.children) do if child==self then table.remove(self.parent.children,i); break end end end
    self.parent=parent; table.insert(parent.children,self)
end
function methods:CreateTexture(name) return New('Texture',name,self) end
function methods:CreateMaskTexture(name) return New('MaskTexture',name,self) end
function methods:CreateFontString(name) return New('FontString',name,self) end
function methods:SetWidth(value) self.width=value; if self.scripts.OnSizeChanged then self.scripts.OnSizeChanged(self) end end
function methods:SetHeight(value) self.height=value; if self.scripts.OnSizeChanged then self.scripts.OnSizeChanged(self) end end
function methods:SetSize(w,h) self.width=w; self.height=h; if self.scripts.OnSizeChanged then self.scripts.OnSizeChanged(self) end end
function methods:GetWidth() if self.width>0 then return self.width end; return self.text and self:GetStringWidth() or (self.parent and self.parent:GetWidth() or 100) end
function methods:GetHeight() return self.height>0 and self.height or 20 end
function methods:ClearAllPoints() self.points={} end
function methods:SetPoint(...) table.insert(self.points,{...}) end
function methods:GetPoint(index) return unpack(self.points[index or 1] or {'BOTTOM',UIParent,'BOTTOM',0,200}) end
function methods:SetAllPoints(target) self.allPoints=target or self.parent end
function methods:GetLeft() return self.left or 500 end
function methods:GetRight() return self:GetLeft()+self:GetWidth() end
function methods:GetBottom() return self.bottom or 200 end
function methods:GetTop() return self:GetBottom()+self:GetHeight() end
function methods:SetFrameLevel(level) self.level=level end
function methods:GetFrameLevel() return self.level end
function methods:SetFrameStrata(value) self.strata=value end
function methods:GetFrameStrata() return self.strata or 'HIGH' end
function methods:SetScale(value) self.scale=value end
function methods:GetScale() return self.scale or 1 end
function methods:GetEffectiveScale() return self:GetScale() end
function methods:SetAlpha(value) self.alpha=value end
function methods:GetAlpha() return self.alpha end
function methods:SetScript(event,fn) self.scripts[event]=fn end
function methods:HookScript(event,fn)
    local previous=self.scripts[event]
    self.scripts[event]=function(...) if previous then previous(...) end; fn(...) end
end
function methods:GetScript(event) return self.scripts[event] end
function methods:IsShown() return self.shown end
function methods:IsVisible() return self.shown and (not self.parent or self.parent:IsVisible()) end
local function Hidden(frame) if frame.scripts.OnHide then frame.scripts.OnHide(frame) end; for _,child in ipairs(frame.children) do if child.shown then Hidden(child) end end end
function methods:Hide() if self.shown then self.shown=false; Hidden(self) end end
function methods:Show() if not self.shown then self.shown=true; if self.scripts.OnShow then self.scripts.OnShow(self) end end end
function methods:SetShown(value) if value then self:Show() else self:Hide() end end
function methods:SetFont(path,size,flags) self.font=path;self.fontSize=size;self.fontFlags=flags end
function methods:GetFont() return self.font or 'Fonts\\FRIZQT__.TTF',self.fontSize or 12,self.fontFlags or '' end
function methods:SetText(value) self.text=value end
function methods:GetText() return self.text end
function methods:GetStringWidth() return string.len(tostring(self.text or ''))*(self.fontSize or 12)*.55 end
function methods:SetTextColor(...) self.color={...} end
function methods:SetTexture(value) self.texture=value;return true end
function methods:GetTexture() return self.texture end
function methods:SetTexCoord(...) self.texCoord={...} end
function methods:SetColorTexture(...) self.color={...} end
function methods:SetVertexColor(...) self.color={...} end
function methods:SetNormalTexture(value) if not self.normal then self.normal=self:CreateTexture() end;self.normal:SetTexture(value) end
function methods:SetPushedTexture(value) if not self.pushed then self.pushed=self:CreateTexture() end;self.pushed:SetTexture(value) end
function methods:SetHighlightTexture(value) if not self.highlight then self.highlight=self:CreateTexture() end;self.highlight:SetTexture(value) end
function methods:GetNormalTexture() return self.normal end
function methods:GetPushedTexture() return self.pushed end
function methods:GetHighlightTexture() return self.highlight end
function methods:AddMaskTexture(mask) self.masks=self.masks or {};table.insert(self.masks,mask) end
function methods:SetStatusBarTexture(value) self.statusTexture=value end
function methods:SetStatusBarColor(...) self.statusColor={...} end
function methods:SetMinMaxValues(low,high) self.minimum=low;self.maximum=high end
function methods:SetValue(value) assert(value==value,'NaN progress'); self.value=value end
function methods:GetValue() return self.value end
function methods:SetBackdrop(value) self.backdrop=value end
function methods:SetBackdropColor(...) self.backdropColor={...} end
function methods:SetBackdropBorderColor(...) self.borderColor={...} end
function methods:SetOwner(owner) self.owner=owner end
function methods:GetOwner() return self.owner end
function methods:AddLine(...) end
function methods:EnableMouse(value) self.mouse=value end
function methods:IsMouseEnabled() return self.mouse end
function methods:SetID(id) self.id=id end
function methods:GetID() return self.id end
function methods:Enable() self.enabled=true end
function methods:Disable() self.enabled=false end
function methods:Click(button) if self.enabled and self.scripts.OnClick then self.scripts.OnClick(self,button or 'LeftButton') end end
function methods:StartMoving() self.moving=true end
function methods:StartSizing() self.sizing=true end
function methods:StopMovingOrSizing() self.moving=false;self.sizing=false end
function methods:SetResizeBounds(...) self.resizeBounds={...} end
function methods:SetCreature(id) self.creature=id; self.fileID=id and id>0 and 119563 or nil end
-- Creature id -> the appearance GetDisplayInfo names; absent reads 0, as an uncached creature does.
MockDisplays={}
function methods:GetDisplayInfo() return MockDisplays[self.creature] or 0 end
function methods:GetModelFileID() return self.fileID end
function methods:ClearModel() self.fileID=nil end
function methods:SetAnimation(value) self.animation=value end
for _,method in ipairs({'SetMovable','SetResizable','SetClampedToScreen','SetUserPlaced','RegisterForDrag',
    'RegisterForClicks','RegisterEvent','EnableMouseWheel','SetClipsChildren','SetShadowColor','SetShadowOffset',
    'SetJustifyH','SetJustifyV','SetWordWrap','SetBlendMode','SetCustomCamera','SetModelScale'}) do
    methods[method]=function() end
end
UIParent=New('Frame','UIParent');UIParent:SetSize(1920,1080)
GameFontNormal=CreateFont('GameFontNormal')
GameTooltip=New('Frame','GameTooltip',UIParent)
UISpecialFrames={}
SOUNDKIT={U_CHAT_SCROLL_BUTTON=1}
function GameTooltip_Hide() GameTooltip:Hide() end
function MouseIsOver(frame) return frame.hovered or false end
function SetCursor() end
function PlaySound() end
function GetTime() return clock end
function UnitName() return 'Tester' end
MockUnits={npc='Creature-0-1-2-3-123-000001'}
function UnitGUID(unit) return MockUnits[unit] end
function SetPortraitTexture(texture,unit)
    assert(MockUnits[unit],'portrait requires an available unit')
    texture.nativeGUID=MockUnits[unit]
    texture.nativeCalls=(texture.nativeCalls or 0)+1
    texture:SetTexture('portrait:'..MockUnits[unit])
end
function SetPortraitTextureFromCreatureDisplayID(texture,display)
    texture.nativeDisplay=display
    texture:SetTexture('display:'..display)
end
function GetRealmName() return 'Test' end
function SetCVar() end
SlashCmdList={}
local timerMethods={}
function timerMethods:ScheduleTimer(fn,delay)
    serial=serial+1;timers[serial]={fn=fn,due=clock+delay};return serial
end
function timerMethods:ScheduleRepeatingTimer(fn,delay)
    local id=self:ScheduleTimer(fn,delay);timers[id].interval=delay;return id
end
function timerMethods:CancelTimer(id) timers[id]=nil end
function LibStub() return {Embed=function(_,object) for key,fn in pairs(timerMethods) do object[key]=fn end;return object end} end
function Advance(seconds)
    clock=clock+seconds
    local ready={}
    for id,timer in pairs(timers) do if timer.due<=clock then table.insert(ready,id) end end
    for _,id in ipairs(ready) do
        local timer=timers[id]
        if timer then if timer.interval then timer.due=clock+timer.interval else timers[id]=nil end;timer.fn() end
    end
    local m=SpokenEnv.MinimalPlayer
    if m and m.frame and m.frame:IsShown() then m:Tick(seconds) end
end
