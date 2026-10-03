-- Minimal native-widget host for layout integration tests. Frame methods are an
-- explicit whitelist; missing WoW APIs fail instead of being silently accepted.
local frames = {}
-- WoW's format supports positional translations that stock Lua 5.1 does not.
format=function(pattern,...)
    local args={...}
    if pattern:find('%%%d+%$') then
        return (pattern:gsub('%%(%d+)%$([%d%.%-]*[sdif])',function(index,spec)
            return string.format('%'..spec,args[tonumber(index)])
        end))
    end
    return string.format(pattern,...)
end
local Widget = {}
Widget.__index = Widget
local function New(parent, kind)
    local w = setmetatable({ parent=parent, kind=kind, scripts={}, points={}, width=0,
        height=0, shown=true, text='', fontSize=16, scale=1, alpha=1 }, Widget)
    frames[#frames+1]=w
    return w
end
function Widget:SetScript(event, fn) self.scripts[event]=fn end
function Widget:HookScript(event, fn)
    local previous=self.scripts[event]
    self.scripts[event]=function(...) if previous then previous(...) end; fn(...) end
end
function Widget:Fire(event, ...) if self.scripts[event] then self.scripts[event](self, ...) end end
function Widget:Show() if not self.shown then self.shown=true; self:Fire('OnShow') end end
function Widget:Hide() if self.shown then self.shown=false; self:Fire('OnHide') end end
function Widget:IsShown() return self.shown end
function Widget:IsVisible() return self.shown and (not self.parent or self.parent:IsVisible()) end
function Widget:SetShown(v) if v then self:Show() else self:Hide() end end
function Widget:GetParent() return self.parent end
function Widget:SetParent(parent) self.parent=parent end
function Widget:SetScale(v) self.scale=v end
function Widget:GetScale() return self.scale end
function Widget:GetEffectiveScale() return self.scale*(self.parent and self.parent:GetEffectiveScale() or 1) end
function Widget:SetAlpha(v) self.alpha=v end
function Widget:GetAlpha() return self.alpha end
function Widget:SetFrameLevel(v) self.level=v end
function Widget:GetFrameLevel() return self.level or (self.parent and self.parent:GetFrameLevel()+1 or 0) end
function Widget:SetSize(w,h)
    if self.bounds then
        w=math.max(self.bounds[1],math.min(self.bounds[3],w))
        h=math.max(self.bounds[2],math.min(self.bounds[4],h))
    end
    local changed=w~=self.width or h~=self.height
    self.width,self.height=w,h
    if changed then self:Fire('OnSizeChanged',w,h) end
end
function Widget:SetWidth(w) self:SetSize(w,self.height) end
function Widget:SetHeight(h) self:SetSize(self.width,h) end
function Widget:SetResizeBounds(a,b,c,d)
    self.bounds={a,b,c,d}
    self:SetSize(self.width,self.height)
end
function Widget:SetPoint(point, relative, relativePoint, x, y)
    if type(relative)=='number' then x,y=relative,relativePoint; relative,relativePoint=self.parent,point
    elseif not relative then relative,relativePoint=self.parent,point
    elseif type(relativePoint)~='string' then x,y=relativePoint,x; relativePoint=point end
    local data={point,relative,relativePoint,x or 0,y or 0}
    for i,p in ipairs(self.points) do if p[1]==point then self.points[i]=data; return end end
    self.points[#self.points+1]=data
end
function Widget:GetPoint(i) return unpack(self.points[i or 1] or {}) end
function Widget:ClearAllPoints() self.points={}; self.allPoints=nil end
function Widget:SetAllPoints(w) self.allPoints=w or self.parent end
local function Factor(point,axis)
    if axis=='x' then return point:find('LEFT') and 0 or point:find('RIGHT') and 1 or .5 end
    return point:find('BOTTOM') and 0 or point:find('TOP') and 1 or .5
end
local function Target(self,p,axis)
    local rel=p[2]
    if not rel then return axis=='x' and p[4] or p[5] end
    local start=axis=='x' and rel:GetLeft() or rel:GetBottom()
    local dim=axis=='x' and rel:GetWidth() or rel:GetHeight()
    return (start+dim*Factor(p[3],axis))*rel:GetEffectiveScale()/self:GetEffectiveScale()+(axis=='x' and p[4] or p[5])
end
function Widget:Dimension(axis)
    if self.allPoints then return axis=='x' and self.allPoints:GetWidth() or self.allPoints:GetHeight() end
    local fixed=axis=='x' and self.width or self.height
    if fixed>0 then return fixed end
    for i,p in ipairs(self.points) do
        for j=i+1,#self.points do
            local q=self.points[j]
            local diff=Factor(q[1],axis)-Factor(p[1],axis)
            if diff~=0 then return math.max(0,(Target(self,q,axis)-Target(self,p,axis))/diff) end
        end
    end
    if self.kind=='FontString' then return axis=='x' and self:GetStringWidth() or self.fontSize end
    return 0
end
function Widget:GetWidth() return self:Dimension('x') end
function Widget:GetHeight() return self:Dimension('y') end
function Widget:Position(axis)
    if self.allPoints then return axis=='x' and self.allPoints:GetLeft() or self.allPoints:GetBottom() end
    local p=self.points[1]
    if not p then return 0 end
    return Target(self,p,axis)-Factor(p[1],axis)*self:Dimension(axis)
end
function Widget:GetLeft() return self:Position('x') end
function Widget:GetBottom() return self:Position('y') end
function Widget:GetRight() return self:GetLeft()+self:GetWidth() end
function Widget:GetTop() return self:GetBottom()+self:GetHeight() end
function Widget:GetCenter() return self:GetLeft()+self:GetWidth()/2,self:GetBottom()+self:GetHeight()/2 end
function Widget:SetText(text) self.text=text==nil and '' or tostring(text) end
function Widget:GetText() return self.text end
function Widget:SetFont(_,size) self.fontSize=size end
function Widget:SetWordWrap(value) self.wordWrap=value end
function Widget:SetTextColor(...) self.textColor={...} end
function Widget:SetShadowColor(...) self.shadowColor={...} end
function Widget:SetShadowOffset(...) self.shadowOffset={...} end
function Widget:GetStringWidth()
    local clean=self.text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|r','')
    local units=0
    for char in clean:gmatch('[%z\1-\127\194-\244][\128-\191]*') do
        units=units+(char=='i' and .25 or char=='W' and .85 or char==' ' and .3 or .5)
    end
    return units*self.fontSize
end
function Widget:GetStringHeight() return self.fontSize end
function Widget:SetScrollChild(child) self.child=child end
function Widget:SetVerticalScroll(v) self.scroll=v; self:Fire('OnVerticalScroll',v) end
function Widget:GetVerticalScroll() return self.scroll or 0 end
function Widget:CreateFontString(_,_,template)
    local label=New(self,'FontString')
    if template and _G[template] then label.fontSize=_G[template].fontSize end
    return label
end
function Widget:CreateTexture() return New(self,'Texture') end
for _,kind in ipairs({'Normal','Pushed','Highlight'}) do
    Widget['Set'..kind..'Texture']=function(self,path)
        self[kind]=self[kind] or New(self,'Texture'); self[kind].texture=path
    end
    Widget['Get'..kind..'Texture']=function(self) return self[kind] end
end
function Widget:SetTexture(path) self.texture=path end
function Widget:SetID(v) self.id=v end
function Widget:GetID() return self.id end
function Widget:SetOwner(v) self.owner=v end
function Widget:GetOwner() return self.owner end
function Widget:SetBackdrop(v) self.backdrop=v end
function Widget:StartMoving() self.moving=true end
function Widget:StopMovingOrSizing() self.moving=false end
function Widget:SetFrameStrata(v) self.strata=v end
function Widget:GetFrameStrata() return self.strata or 'MEDIUM' end
for _,method in ipairs({'SetClampedToScreen','SetMovable','SetResizable',
    'SetBackdropColor','SetBackdropBorderColor','EnableMouse','RegisterForDrag','RegisterForClicks',
    'SetJustifyH','SetJustifyV','SetSpacing','StartSizing','SetClipsChildren','EnableMouseWheel',
    'SetColorTexture','RegisterEvent','SetUserPlaced','SetTexCoord','SetVertexColor',
    'SetStatusBarTexture','SetMinMaxValues','SetValue','SetStatusBarColor','Enable','Disable','AddLine',
    'SetBlendMode'}) do Widget[method]=function() end end
CreateFrame=function(kind,name,parent)
    local w=New(parent,kind); if name then _G[name]=w end; return w
end
CreateFont=function(name) local font=New(nil,'FontString'); _G[name]=font; return font end
UIParent=New(); UIParent:SetSize(1600,1000)
GameTooltip=New(UIParent)
GameTooltip_Hide=function() GameTooltip:Hide() end
UISpecialFrames={}
MouseIsOver=function() return false end
SetCursor=function() end
return frames
