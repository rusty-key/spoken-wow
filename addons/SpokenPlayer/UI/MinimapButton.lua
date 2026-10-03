setfenv(1, SpokenEnv)

-- The one minimap button. Feature addons contribute menu entries rather than buttons of
-- their own, so a player with two Spoken addons installed gets one icon, not two.
--
-- Left-click opens a menu: the player's entries, then each source's, grouped in source
-- order. Right-click opens settings. Middle-click runs the configured command. All
-- three are rebindable, which is what keeps VoiceOverRedux's three-configurable-clicks
-- behaviour for the players who use it.
Minimap = { entries = {} }

local ICON = [[Interface\AddOns\SpokenPlayer\Textures\MinimapButton]]
local ldbObject, menuFrame, minimapButton

-- The player's own entries.
local PLAYER_ENTRIES = {
    { id = "PlayPause", text = L.PLAY_PAUSE, order = 1, onClick = function() SoundQueue:TogglePauseQueue() end },
    { id = "Stop",      text = L.STOP,       order = 2, onClick = function() SoundQueue:RemoveAllSoundsFromQueue() end },
    { id = "Settings",  text = L.SETTINGS,   order = 3, onClick = function() Options:Open() end },
}

--- entry = { id, text, icon, order, onClick(button), tooltip(GameTooltip), visible() }
function Minimap:AddEntry(sourceKey, entry)
    self.entries[sourceKey] = self.entries[sourceKey] or {}
    self:RemoveEntry(sourceKey, entry.id)
    table.insert(self.entries[sourceKey], entry)
    table.sort(self.entries[sourceKey], function(a, b) return (a.order or 100) < (b.order or 100) end)
end

function Minimap:RemoveEntry(sourceKey, id)
    local list = self.entries[sourceKey]
    if not list then return end
    for i = getn(list), 1, -1 do
        if list[i].id == id then table.remove(list, i) end
    end
end

--- The menu as a flat list, in the order it is shown.
function Minimap:BuildMenu()
    local menu = {}
    for _, entry in ipairs(PLAYER_ENTRIES) do
        if not entry.visible or entry.visible() then table.insert(menu, entry) end
    end
    for key, source in Sources:Iterate() do
        -- A part switched off has no entries: it is off.
        for _, entry in ipairs(Sources:IsTurnedOff(source) and {} or self.entries[key] or {}) do
            if not entry.visible or entry.visible() then
                entry.sourceTitle = source.title
                table.insert(menu, entry)
            end
        end
    end
    return menu
end

--- An entry by id, across the player and every source.
function Minimap:FindEntry(id)
    for _, entry in ipairs(self:BuildMenu()) do
        if entry.id == id then return entry end
    end
end

-- Two menus, because there are two kinds of client.
--
-- Where the client has UIDropDownMenu, that is what opens: it is the menu every other
-- addon uses, and it brings its own background, its highlight under the cursor, its
-- closing on a click elsewhere and its toggling, none of which is worth reimplementing.
--
-- The three legacy clients do not have it in a shape worth using -- EasyMenu does
-- not exist on 1.12 at all, and the initializer differs on the other two -- so there the
-- player draws its own list of buttons and supplies those four behaviours by hand. That
-- code exists for those clients only, and is below.
local dropDown
local menuCatcher
local iconTooltip

local function HideMenu()
    if menuFrame then
        menuFrame:Hide()
    end
    if menuCatcher then
        menuCatcher:Hide()
    end
end

--- Whether a menu of ours is open, either kind. Read from the client rather than
--- remembered: a Blizzard menu closes on a click elsewhere without telling anyone, and a
--- flag left set would suppress the tooltip for the rest of the session.
local function MenuIsOpen()
    if menuFrame and menuFrame:IsShown() then
        return true
    end
    local list = _G.DropDownList1
    if dropDown and list and list.IsShown and list:IsShown()
        and _G.UIDROPDOWNMENU_OPEN_MENU == dropDown then
        return true
    end
    return false
end

--- Whether the client has a context menu of its own worth opening.
local function HasMenuAPI()
    return UIDropDownMenu_Initialize and UIDropDownMenu_AddButton and UIDropDownMenu_CreateInfo
        and ToggleDropDownMenu and true or false
end

--- The client's own menu. Entries are grouped under each source's title, which a plain
--- list could only show as a gap.
local function ToggleClientMenu(anchor)
    if not dropDown then
        dropDown = CreateFrame("Frame", "SpokenMinimapDropDown", UIParent, "UIDropDownMenuTemplate")
        UIDropDownMenu_Initialize(dropDown, function(_, level)
            local lastGroup, shownAny = nil, false
            for _, entry in ipairs(Minimap:BuildMenu()) do
                if entry.sourceTitle and entry.sourceTitle ~= lastGroup then
                    -- A rule above each addon's heading. Without one the heading is the
                    -- only thing between the groups, and it reads as a row of the group
                    -- above rather than the start of the one below.
                    if lastGroup ~= nil or shownAny then
                        if UIDropDownMenu_AddSeparator then
                            UIDropDownMenu_AddSeparator(level)
                        else
                            -- Older clients have no separator: a disabled blank row is
                            -- the gap every addon drew before there was one.
                            local gap = UIDropDownMenu_CreateInfo()
                            gap.text = " "
                            gap.isTitle = true
                            gap.notCheckable = true
                            gap.disabled = true
                            UIDropDownMenu_AddButton(gap, level)
                        end
                    end
                    lastGroup = entry.sourceTitle
                    local heading = UIDropDownMenu_CreateInfo()
                    heading.text = entry.sourceTitle
                    heading.isTitle = true
                    heading.notCheckable = true
                    UIDropDownMenu_AddButton(heading, level)
                end
                local info = UIDropDownMenu_CreateInfo()
                info.text = entry.text
                info.icon = entry.icon
                info.notCheckable = true
                info.func = function()
                    if entry.onClick then entry.onClick(anchor) end
                    if CloseDropDownMenus then CloseDropDownMenus() end
                end
                UIDropDownMenu_AddButton(info, level)
                shownAny = true
            end
        end, "MENU")
    end
    ToggleDropDownMenu(1, nil, dropDown, anchor, 0, 0)
end

local function ShowMenu(anchor)
    if not menuFrame then
        menuFrame = CreateFrame("Frame", "SpokenMinimapMenu", UIParent, "BackdropTemplate")
        menuFrame:SetFrameStrata("DIALOG")
        menuFrame:SetClampedToScreen(true)
        -- The template only supplies the methods; without a backdrop of its own the frame
        -- draws nothing and the rows read as text floating over the game world. The same
        -- dialog art the lore window uses, so the two look like one addon.
        if menuFrame.SetBackdrop then
            menuFrame:SetBackdrop({
                bgFile = [[Interface\DialogFrame\UI-DialogBox-Background-Dark]],
                edgeFile = [[Interface\DialogFrame\UI-DialogBox-Border]],
                tile = true,
                tileSize = 32,
                edgeSize = 32,
                insets = { left = 11, right = 12, top = 12, bottom = 11 },
            })
        end
        menuFrame.rows = {}

        -- A menu is closed by clicking anywhere else, which nothing tells the frame about.
        -- A transparent button over the whole screen, shown only while the menu is, is how
        -- that is heard on every client: GLOBAL_MOUSE_DOWN exists on none of the three
        -- legacy ones.
        menuCatcher = CreateFrame("Button", "SpokenMinimapMenuCatcher", UIParent)
        menuCatcher:SetAllPoints(UIParent)
        menuCatcher:SetFrameStrata("DIALOG")
        menuCatcher:SetFrameLevel(1)
        menuCatcher:RegisterForClicks("AnyUp")
        menuCatcher:SetScript("OnClick", HideMenu)
        menuCatcher:Hide()
        menuFrame:SetFrameLevel(10)
    end
    local menu = Minimap:BuildMenu()
    -- The dialog border is 32 pixels of art with roughly 12 of it inside the frame, so the
    -- rows start below it rather than under it.
    local PADDING = 14
    local y, width = -PADDING, 168
    local lastGroup
    for i, entry in ipairs(menu) do
        local row = menuFrame.rows[i]
        if not row then
            row = CreateFrame("Button", nil, menuFrame)
            row:SetHeight(18)
            -- Without it the menu gives no sign of which row a click would hit.
            row:SetHighlightTexture([[Interface\QuestFrame\UI-QuestTitleHighlight]])
            local highlight = row:GetHighlightTexture()
            if highlight and highlight.SetBlendMode then
                highlight:SetBlendMode("ADD")
            end
            row.text = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
            row.text:SetPoint("LEFT", 2, 0)
            row:SetScript("OnClick", function(self)
                HideMenu()
                if self.entry.onClick then self.entry.onClick(self) end
            end)
            menuFrame.rows[i] = row
        end
        if entry.sourceTitle and entry.sourceTitle ~= lastGroup then
            y = y - 4
            lastGroup = entry.sourceTitle
        end
        row.entry = entry
        row.text:SetText(entry.text)
        row:SetPoint("TOPLEFT", PADDING, y)
        row:SetWidth(width - PADDING * 2)
        row:Show()
        y = y - 18
    end
    for i = getn(menu) + 1, getn(menuFrame.rows) do menuFrame.rows[i]:Hide() end
    menuFrame:SetSize(width, -y + PADDING)
    menuFrame:ClearAllPoints()
    menuFrame:SetPoint("TOPRIGHT", anchor, "BOTTOMLEFT")
    menuFrame:Show()
    menuCatcher:Show()
end

--- Open it, or close it if this is the second click of the button that opened it.
local function ToggleMenu(anchor)
    -- The menu opens under a cursor that is still on the button, so the button's own
    -- tooltip is up and the two overlap.
    if iconTooltip then
        iconTooltip:Hide()
    end
    if HasMenuAPI() then
        ToggleClientMenu(anchor)
        return
    end
    if menuFrame and menuFrame:IsShown() then
        HideMenu()
        return
    end
    ShowMenu(anchor)
end

--- One click on the button, wherever it is: on the minimap or in Blizzard's addon
--- compartment. `button` is the frame a menu opens on and the one feature addons get;
--- the lib's own button, not the frame the compartment clicked with (see OnClick).
function Minimap:HandleClick(button, mouseButton)
    local command = Addon.db.profile.Minimap.Commands[mouseButton]
    if command == "Menu" then
        ToggleMenu(button)
    elseif command and command ~= "" then
        local entry = Minimap:FindEntry(command)
        if entry and entry.onClick then
            PlaySound(SOUNDKIT.U_CHAT_SCROLL_BUTTON)
            entry.onClick(button)
        end
    end
end

function Minimap:Setup()
    if ldbObject then return end
    local LibDataBroker = LibStub("LibDataBroker-1.1", true)
    local LibDBIcon = LibStub("LibDBIcon-1.0", true)
    if not LibDataBroker or not LibDBIcon then return end

    local db = Addon.db.profile.Minimap.LibDBIcon
    -- Seeded once, so the button does not start at angle 0 under other addons' buttons.
    if db.minimapPos == nil then db.minimapPos = 204 end

    ldbObject = LibDataBroker:NewDataObject("Spoken", {
        type = "launcher",
        text = "Spoken",
        icon = ICON,
        OnClick = function(button, mouseButton)
            -- Blizzard's compartment calls the registered entry with its own menu frame,
            -- which is closing as the click is handled: a menu opened on it is lost with
            -- that frame (the first click shows nothing, and the leftover surfaces on
            -- the next compartment open). From the compartment, wait for the close to
            -- finish and open on our own button, which neither moves nor closes.
            if minimapButton and button ~= minimapButton then
                if C_Timer and C_Timer.After then
                    C_Timer.After(0.05, function()
                        Minimap:HandleClick(minimapButton, mouseButton)
                    end)
                    return
                end
                button = minimapButton
            end
            Minimap:HandleClick(button, mouseButton)
        end,
        OnTooltipShow = function(tooltip)
            -- LibDBIcon shows the tooltip whatever this adds to it, so a menu that is
            -- already open has to hide it as it appears rather than decline to fill it.
            iconTooltip = tooltip
            if not tooltip.spokenMenuHook then
                tooltip.spokenMenuHook = true
                tooltip:HookScript("OnShow", function(self)
                    if MenuIsOpen() then
                        self:Hide()
                    end
                end)
            end
            if MenuIsOpen() then
                tooltip:Hide()
                return
            end
            tooltip:SetText("Spoken")
            local head = SoundQueue:GetCurrentSound()
            if head and head.present then
                tooltip:AddLine(head.present.header or "", 1, 0.82, 0)
                tooltip:AddLine(head.present.label or "", 0.8, 0.8, 0.8)
            end
            tooltip:AddLine(" ")
            tooltip:AddLine(L.MENU_LEFT, 0.7, 0.7, 0.7)
            tooltip:AddLine(L.MENU_MIDDLE, 0.7, 0.7, 0.7)
            tooltip:AddLine(L.MENU_RIGHT, 0.7, 0.7, 0.7)
        end,
    })
    LibDBIcon:Register("Spoken", ldbObject, db)
    -- The frame the lib built for this addon. The compartment hands the OnClick a
    -- different, short-lived frame (see OnClick), so the real button is kept here.
    minimapButton = LibDBIcon:GetMinimapButton("Spoken")
end

function Minimap:Refresh()
    local LibDBIcon = LibStub("LibDBIcon-1.0", true)
    if LibDBIcon and ldbObject then
        LibDBIcon:Refresh("Spoken", Addon.db.profile.Minimap.LibDBIcon)
    end
end

--- Whether the Spoken button also shows in Blizzard's addon compartment, on the
--- modern clients that have one. The flag is the settings panel's; the lib's add and
--- remove keep the compartment's entry in step, and writing the flag first means the
--- choice sticks even where the frame does not exist to be updated.
function Minimap:ToggleCompartment(shouldShow)
    local db = Addon.db.profile.Minimap.LibDBIcon
    db.showInCompartment = shouldShow
    local LibDBIcon = LibStub("LibDBIcon-1.0", true)
    if not LibDBIcon then return end
    if shouldShow then
        LibDBIcon:AddButtonToCompartment("Spoken")
    else
        LibDBIcon:RemoveButtonFromCompartment("Spoken")
    end
end
