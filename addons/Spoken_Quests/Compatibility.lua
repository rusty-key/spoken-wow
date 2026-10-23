setfenv(1, VoiceOver)

-- Patch 11.0.2 removed the legacy global AddOn-management API. Current
-- Classic clients expose the same operations through C_AddOns, with the
-- character/addon argument order reversed for GetAddOnEnableState.
-- Keep these shims private to VoiceOver's environment so other addons are
-- not affected.
if C_AddOns then
    GetNumAddOns = GetNumAddOns or C_AddOns.GetNumAddOns
    GetAddOnInfo = GetAddOnInfo or C_AddOns.GetAddOnInfo
    GetAddOnMetadata = GetAddOnMetadata or C_AddOns.GetAddOnMetadata
    IsAddOnLoadOnDemand = IsAddOnLoadOnDemand or C_AddOns.IsAddOnLoadOnDemand
    LoadAddOn = LoadAddOn or C_AddOns.LoadAddOn
    EnableAddOn = EnableAddOn or C_AddOns.EnableAddOn
    DisableAddOn = DisableAddOn or C_AddOns.DisableAddOn

    if not GetAddOnEnableState and C_AddOns.GetAddOnEnableState then
        function GetAddOnEnableState(character, addon)
            if addon == nil then
                addon = character
                character = nil
            end
            return C_AddOns.GetAddOnEnableState(addon, character)
        end
    end

    if not IsAddOnLoaded and C_AddOns.IsAddOnLoaded then
        function IsAddOnLoaded(addon)
            local loadedOrLoading, loaded = C_AddOns.IsAddOnLoaded(addon)
            if loaded ~= nil then
                return loaded
            end
            return loadedOrLoading
        end
    end
end

-- The namespaced gossip API is used by every modern Classic branch,
-- including Burning Crusade Anniversary. The upstream compatibility file
-- omitted that branch.
if C_GossipInfo then
    GetGossipText = GetGossipText or C_GossipInfo.GetText
    GetNumGossipActiveQuests = GetNumGossipActiveQuests or C_GossipInfo.GetNumActiveQuests
    GetNumGossipAvailableQuests = GetNumGossipAvailableQuests or C_GossipInfo.GetNumAvailableQuests
end

-- Camelot (1.60.1, interface 16001) ships FrameXML without the global
-- SetDesaturation helper; only the Texture:SetDesaturated method survives.
-- AceGUI's CheckBox calls the global by name, and the embedded libs run in _G
-- rather than in this environment, so unlike every other shim in this file
-- that one has to be written to _G. Guarded, so a client that still defines
-- it keeps its own, and the body is Blizzard's: SetDesaturated returns false
-- where the shader is unsupported, and the grey vertex colour is the fallback.
if not _G.SetDesaturation then
    function _G.SetDesaturation(texture, desaturation)
        local shaderSupported = texture.SetDesaturated and texture:SetDesaturated(desaturation)
        if not shaderSupported then
            if desaturation then
                texture:SetVertexColor(0.5, 0.5, 0.5)
            else
                texture:SetVertexColor(1.0, 1.0, 1.0)
            end
        end
    end
end

-- The Forever client (1.60.1, interface 16001) reports itself as mainline and draws the
-- modern map-attached quest log. `QuestLogFrame`, `QuestLog_Update`, `GetQuestLogTitle` and
-- `QUESTS_DISPLAYED` do not exist there, and the rows are pooled frames with no names, so
-- QuestOverlayUI's walk over `QuestLogTitle1..QUESTS_DISPLAYED` had nothing to walk and no
-- hook to run from: the play button was simply absent from the quest log on that client.
--
-- Feature-detected rather than keyed to the client, since this is the quest log every
-- mainline-flavoured client draws, and the one the Era client will draw if it ever adopts it.
if QuestLogQuests_Update and QuestScrollFrame and QuestScrollFrame.titleFramePool and
    QuestScrollFrame.titleFramePool.EnumerateActive then

    local POI_BUTTON_SIZE = 20

    function QuestOverlayUI:GetPlayButtonParent()
        return QuestScrollFrame
    end

    -- Dressed as the player's square Play button: the tracking checkbox's border beside it, Play's
    -- own glyph inside, as the Zones story and the narrator styles have it. A failure leaves the
    -- button as it was and is said once, so the quest log never loses its Play.
    local said
    local function Say(err)
        if said then return end
        said = true
        print("|cffff8080Spoken Quests:|r the quest log's Play button kept its old look: " .. tostring(err))
    end
    -- Built bare, not from the old button: its own art would stay drawn over the checkbox's border.
    local MakePlayButton = QuestOverlayUI.MakePlayButton
    function QuestOverlayUI:MakePlayButton(parent)
        if Spoken and Spoken.DressBoxButton then
            local button = Utils:CreateDetachedFrame("Button", nil, parent or self:GetPlayButtonParent())
            button:SetSize(20, 20)
            button:SetHitRectInsets(2, 2, 2, 2)
            local ok, err = pcall(Spoken.DressBoxButton, Spoken, button)
            if ok then
                button.setPlayState = QuestOverlayUI.FollowQueue
                return button
            end
            Say(err)
            button:Hide()
        end
        return MakePlayButton(self, parent)
    end

    --- The client's own objective icon for this quest, drawn when "Quest objectives" is on: a
    --- small square button carrying the quest's ID, anchored to the row's top left corner and
    --- pooled beside the rows rather than parented to them. The play button is the one frame
    --- of that size and shape that is not it.
    local function QuestPOIButton(row)
        local questID = row.questID
        for _, child in ipairs({ row:GetParent():GetChildren() }) do
            if child ~= QuestOverlayUI.questPlayButtons[questID] and child.questID == questID and
                child:IsShown() and child.GetObjectType and child:GetObjectType() == "Button" and
                math.abs(child:GetWidth() - POI_BUTTON_SIZE) < 1 then
                return child
            end
        end
    end

    -- The client anchors a row's title to what the title ends against, the quest's type in
    -- words ("(Elite)") or else the storyline icon, whose left edge is the left of the row's
    -- icons, and only then measures the title's height. Moving that end left as it is set,
    -- when the button will sit there, makes the client wrap and measure the title with the
    -- button's room already taken, so the button covers neither the title nor the type.
    local TITLE_ROOM = POI_BUTTON_SIZE + 3
    -- Where the client last anchored each row's title ({ relativeTo, relativePoint, x, y }), and
    -- whether the title now ends TITLE_ROOM short of that.
    local titleAnchor = setmetatable({}, { __mode = "k" })
    local reserved = setmetatable({}, { __mode = "k" })
    local hookedTitles = setmetatable({}, { __mode = "k" })
    local reserving

    -- These hooks run inside the client's own calls, where an error would reach its quest log.
    local function Guarded(fn)
        return function(...)
            local ok, err = pcall(fn, ...)
            if not ok then
                Debug:Note("quest log", "title-hook", "the quest log's title hook failed: %s", tostring(err))
            end
        end
    end

    --- Whether the client gives this row its objective icon, by POIButtonOwnerMixin's own rule.
    --- A row the client has not yet given its quest still holds the last one's ID, or none.
    local function GetsObjectiveIcon(row)
        if not (GetCVarBool and GetCVarBool("questPOI")) then return false end
        local questID = row.questID
        if type(questID) ~= "number" or not (C_QuestLog and C_QuestLog.IsQuestCalling) then return true end
        local ok, calling = pcall(C_QuestLog.IsQuestCalling, questID)
        return not (ok and calling)
    end

    --- Ends the row's title short of the button's room, or gives that room back.
    local function SetTitleEnd(row, narrow)
        local anchor = titleAnchor[row]
        if not anchor or (reserved[row] or false) == narrow then return end
        reserving = true
        local ok, err = pcall(row.Text.SetPoint, row.Text, "RIGHT", anchor.relativeTo, anchor.relativePoint,
            anchor.x - (narrow and TITLE_ROOM or 0), anchor.y)
        reserving = false
        if ok then
            reserved[row] = narrow
        else
            Debug:Note("quest log", "title-end", "the quest log's title could not be re-anchored: %s", tostring(err))
        end
    end

    -- SetPoint(point, relativeTo, relativePoint, x, y), or without the relative point:
    -- SetPoint(point, relativeTo, x, y), where it is the point itself.
    local OnTitleAnchored = Guarded(function(text, point, relativeTo, relativePoint, x, y)
        if reserving or point ~= "RIGHT" or type(relativeTo) ~= "table" then return end
        if type(relativePoint) ~= "string" then
            relativePoint, x, y = point, relativePoint, x
        end
        local row = text:GetParent()
        titleAnchor[row] = { relativeTo = relativeTo, relativePoint = relativePoint, x = x or 0, y = y or 0 }
        reserved[row] = false
        SetTitleEnd(row, Addon:IsPartOn() and GetsObjectiveIcon(row) and true or false)
    end)

    local HookTitles = Guarded(function(pool)
        for row in pool:EnumerateActive() do
            if row.Text and not hookedTitles[row] then
                hookedTitles[row] = true
                local ok, err = pcall(hooksecurefunc, row.Text, "SetPoint", OnTitleAnchored)
                if not ok then
                    Debug:Note("quest log", "title-hook", "the quest log's title could not be hooked: %s", tostring(err))
                end
            end
        end
    end)
    HookTitles(QuestScrollFrame.titleFramePool)
    -- A row is handed out before its title is anchored, so a new one is hooked in time.
    pcall(hooksecurefunc, QuestScrollFrame.titleFramePool, "Acquire", HookTitles)

    -- Left of the title, in the inset the row leaves at its left - unless the client draws its
    -- objective icon in that inset, when the button goes to the other end of the row, where
    -- the title is made to end short of it. Not the blank prefix the old quest log's buttons
    -- indent a title with, either: this title wraps into a height the layout has already
    -- decided, and a prefix re-wraps it inside a row too short to hold the extra line.
    function QuestOverlayUI:UpdateQuestTitle(questLogTitleFrame, playButton)
        playButton:ClearAllPoints()
        if playButton.MatchBox and questLogTitleFrame.Checkbox then
            local ok, err = pcall(playButton.MatchBox, playButton, questLogTitleFrame.Checkbox)
            if not ok then Say(err) end
        end
        -- The title's end was set as the client anchored it, and is not moved now that the row
        -- is laid out: the button goes to that end only where the title was ended short of it.
        -- A title the hook never saw is judged by the row's icon.
        local anchor = titleAnchor[questLogTitleFrame]
        local atRightEnd = reserved[questLogTitleFrame] or (not anchor and QuestPOIButton(questLogTitleFrame) ~= nil)
        local ends = anchor and anchor.relativeTo or questLogTitleFrame.Checkbox
        if atRightEnd and ends then
            playButton:SetPoint("RIGHT", ends, anchor and anchor.relativePoint or "LEFT", -3, anchor and anchor.y or 0)
        elseif atRightEnd then
            playButton:SetPoint("TOPRIGHT", questLogTitleFrame, "TOPRIGHT", -4, -2)
        else
            playButton:SetPoint("TOPLEFT", questLogTitleFrame, "TOPLEFT", 6, -4)
        end
    end

    function QuestOverlayUI:Update()
        -- Every button, not only the ones on screen: a row released back to the pool keeps
        -- the button parented to it, and a stale button on a reused row marks the wrong quest.
        for _, button in pairs(self.displayedButtons) do
            button:Hide()
        end
        table.wipe(self.displayedButtons)
        -- Switched off, the part puts nothing on the log.
        if not Addon:IsPartOn() then return end

        for row in QuestScrollFrame.titleFramePool:EnumerateActive() do
            local questID = row.questID
            if questID then
                if not self.questPlayButtons[questID] then
                    self:CreatePlayButton(questID)
                end
                local playButton = self.questPlayButtons[questID]
                local shown = playButton

                if DataModules:PrepareSound({ event = Enums.SoundEvent.QuestAccept, questID = questID }) then
                    self:UpdatePlayButton(QuestOverlayUI:GetQuestTitle(questID, row), questID, row, row.Text,
                        row.Checkbox)
                    playButton:Enable()
                else
                    -- No sound: Contribute where Play would be, or Play greyed out where this
                    -- client cannot contribute.
                    local contribute = self:ContributeButtonFor(questID, QuestOverlayUI:GetQuestTitle(questID, row))
                    if contribute then
                        playButton:Hide()
                        shown = contribute
                    else
                        playButton:Disable()
                    end
                    shown:SetParent(row:GetParent())
                    if contribute then
                        contribute:SetFrameLevel(row:GetFrameLevel() + 2)
                    end
                    self:UpdateQuestTitle(row, shown)
                end

                shown:Show()
                if shown == playButton then
                    self:UpdatePlayButtonTexture(questID)
                end
                table.insert(self.displayedButtons, shown)
            end
        end
    end

    --- The row draws its title with the quest's level in front of it; the sound data
    --- everywhere else is keyed by the title the client reports.
    function QuestOverlayUI:GetQuestTitle(questID, row)
        local title = C_QuestLog and C_QuestLog.GetTitleForQuestID and C_QuestLog.GetTitleForQuestID(questID)
        return title or (row and row.Text and row.Text:GetText()) or ""
    end

    -- The modern log redraws through this one function, which is what `QuestLog_Update` was
    -- on the old one. VoiceOver.lua hooks that name and finds nothing here.
    hooksecurefunc("QuestLogQuests_Update", function()
        QuestOverlayUI:Update()
    end)

    -- The details view is a second place a quest is read from, and the list's buttons cannot
    -- follow it there: a frame has one parent. Play, Report and Contribute, rebound to whichever
    -- quest the panel is showing, in the corner opposite its Back button.
    if QuestMapFrame and QuestMapFrame.DetailsFrame and QuestMapFrame_ShowQuestDetails then
        function QuestOverlayUI:UpdateDetailsPlayButton()
            if not Addon:IsPartOn() then
                if self.detailsPlayButton then self.detailsPlayButton:Hide() end
                if self.detailsReportButton then self.detailsReportButton:Hide() end
                if self.detailsContributeButton then self.detailsContributeButton:Hide() end
                return
            end
            local details = QuestMapFrame.DetailsFrame
            local questID = details.questID or
                (C_QuestLog and C_QuestLog.GetSelectedQuest and C_QuestLog.GetSelectedQuest())
            if not questID or questID == 0 then
                return
            end

            -- The player draws the round buttons (Spoken:CreateRoundButton); without it there is
            -- nothing to play.
            if not (Spoken and Spoken.CreateRoundButton) then
                return
            end
            if not self.detailsPlayButton then
                -- Play and Report as the lore window and the map's lore panel have them: the
                -- player's own round buttons, 24 across and 4 apart, Report in the corner.
                -- Level with the Back button: its inset and vertical offset on the same strip
                -- keep them on one line whatever the client sizes them to.
                --
                -- Under the panel's own header strip, which is what the Back button hangs
                -- off: a button parented to the details frame itself draws its artwork
                -- beneath the border art and arrives as a floating label with no button
                -- behind it. Detached, because the details panel is open
                -- (Utils:CreateDetachedFrame).
                local header = details.BackFrame or details
                local backButton = header.BackButton
                local _, _, _, backInset, backOffset = backButton and backButton:GetPoint(1)
                local report = Spoken:CreateRoundButton(header, "report")
                report:SetFrameLevel(header:GetFrameLevel() + 2)
                report:SetPoint("RIGHT", header, "RIGHT", -(backInset or 11), backOffset or 4)

                local playButton = Spoken:CreateRoundButton(header, "play", "SpokenQuestsDetailsPlayButton")
                playButton:SetFrameLevel(header:GetFrameLevel() + 2)
                playButton:SetPoint("RIGHT", report, "LEFT", -4, 0)
                playButton.setPlayState = QuestOverlayUI.FollowQueue
                self.detailsPlayButton = playButton
                -- Hide Report Buttons, in Spoken's settings, fires no game event.
                if Spoken.RegisterCallback then
                    Spoken:RegisterCallback("REPORT_SETTINGS_CHANGED", function()
                        QuestOverlayUI:UpdateDetailsPlayButton()
                    end)
                end

                -- With no line to play, the pair gives way to Contribute, in words: no glyph
                -- says it. In the corner where Report sits. Named, since UIPanelButtonTemplate
                -- names its pieces after its parent.
                local contributeButton = Utils:CreateDetachedFrame("Button", "SpokenQuestsDetailsContributeButton",
                    header, "UIPanelButtonTemplate")
                contributeButton:SetFrameLevel(header:GetFrameLevel() + 2)
                contributeButton:SetHeight(20)
                contributeButton:SetText(L.OPT_CONTRIBUTE)
                contributeButton:SetWidth(math.max(58, (contributeButton:GetTextWidth() or 0) + 24))
                contributeButton:SetPoint("RIGHT", header, "RIGHT", -(backInset or 11), backOffset or 4)
                contributeButton:SetScript("OnLeave", function()
                    if GameTooltip then GameTooltip:Hide() end
                end)
                contributeButton:Hide()
                self.detailsContributeButton = contributeButton

                -- Report: the game's bug in the player's round button, for a wrong reading
                -- of this quest.
                report:SetScript("OnClick", function(button)
                    local target = ReportButton:TargetForQuest(button.questID, Enums.SoundEvent.QuestAccept)
                    local clip = { fromLog = true, questID = button.questID, title = button.title }
                    if target then ReportButton:ShowLink(target, clip) end
                end)
                report:HookScript("OnEnter", function(button)
                    GameTooltip:SetOwner(button, "ANCHOR_LEFT")
                    GameTooltip:SetText(L.OPT_REPORT_PROBLEM)
                    GameTooltip:AddLine(L.OPT_REPORT_QUEST_TIP, 1, 0.8, 0.2, true)
                    -- Its right-click opens the debug log's menu, where Spoken Developer is installed.
                    local hint = Spoken and Spoken.LogMenuHint and Spoken:LogMenuHint()
                    if hint then GameTooltip:AddLine(hint, 0.6, 0.6, 0.6, true) end
                    GameTooltip:Show()
                end)
                report:HookScript("OnLeave", function()
                    GameTooltip:Hide()
                end)
                self.detailsReportButton = report
            end
            local playButton = self.detailsPlayButton
            local report = self.detailsReportButton
            local contributeButton = self.detailsContributeButton
            local title = self:GetQuestTitle(questID)
            report.questID = questID
            report.title = title

            -- Rebound rather than kept: this button stood for a different quest a moment ago. A line
            -- of this quest's already queued is the one it stands for, whoever queued it.
            self:BindPlayButton(playButton, questID, title)
            playButton.soundData = self:QueuedLine(questID)

            -- No sound: Contribute in the pair's place, where this client can contribute at all
            -- (Contribute:CanOfferFromLog); otherwise Play greyed out and nothing to report.
            contributeButton:Hide()
            if DataModules:PrepareSound({ event = Enums.SoundEvent.QuestAccept, questID = questID }) then
                playButton:Enable()
                playButton:Show()
                report:SetShown(not (Spoken.AreReportButtonsHidden and Spoken:AreReportButtonsHidden()))
            elseif Contribute:CanOfferFromLog() then
                playButton:Hide()
                report:Hide()
                contributeButton:SetScript("OnClick", function()
                    Contribute:ShowFromLog(questID, title)
                end)
                contributeButton:SetScript("OnEnter", function(button)
                    Contribute:ShowTooltip(button)
                end)
                Contribute:OfferLogMenu(contributeButton)
                contributeButton:Show()
            else
                playButton:Disable()
                playButton:Show()
                report:Hide()
            end
            -- Play in Report's corner while Report is hidden, rather than beside an empty space.
            playButton:ClearAllPoints()
            if report:IsShown() then
                playButton:SetPoint("RIGHT", report, "LEFT", -4, 0)
            else
                playButton:SetPoint("RIGHT", report, "RIGHT", 0, 0)
            end
            self:SetPlayButtonState(playButton)
        end

        hooksecurefunc("QuestMapFrame_ShowQuestDetails", function()
            QuestOverlayUI:UpdateDetailsPlayButton()
        end)
    end

end

-- Leatrix Plus's enhanced Era quest log decorates the title rows from its own
-- QuestLog_Update hook.  Refresh after that hook or its rewritten rows can cover
-- the overlay's placement until the next quest-log redraw.  The zero-delay call
-- also lets Leatrix finish installing its hook when both addons load together.
do
    if QuestLog_Update then
        local hooked
        local function HookLeatrix()
            if hooked then return end
            hooked = true
            hooksecurefunc("QuestLog_Update", function()
                QuestOverlayUI:Update()
            end)
        end

        local function DeferHook()
            if C_Timer and C_Timer.After then
                C_Timer.After(0, HookLeatrix)
            else
                HookLeatrix()
            end
        end

        if IsAddOnLoaded and IsAddOnLoaded("Leatrix_Plus") then
            DeferHook()
        end

        local watcher = CreateFrame("Frame")
        watcher:RegisterEvent("ADDON_LOADED")
        watcher:SetScript("OnEvent", function(self, _, addon)
            if addon == "Leatrix_Plus" then
                DeferHook()
                self:UnregisterEvent("ADDON_LOADED")
            end
        end)
    end
end

-- Play on the objective tracker's quests, at the right end of each quest's title as the quest log has
-- it: the same square button. The tracker pools its blocks, so a block keeps one button and rebinds it
-- to the quest it shows. Where the client has no such tracker nothing is hooked. A setting on the
-- Quests page takes them all away.
do
    local MODULES = { "QuestObjectiveTracker", "CampaignQuestObjectiveTracker" }
    -- The quest log's tracking checkbox, as it draws on this client (what its Play button matches).
    local BOX, SIZE = "QuestLog-icon-ticksquare", 14
    local buttons, hooked = {}, {}

    local function Dress(block)
        local questID = block.id
        local button = buttons[block]
        if type(questID) ~= "number" or not (Spoken and Spoken.DressBoxButton) or not Addon:IsPartOn()
            or not (Addon.db and Addon.db.profile.TrackerPlayButton)
            or not DataModules:PrepareSound({ event = Enums.SoundEvent.QuestAccept, questID = questID }) then
            if button then button:Hide() end
            return
        end
        if not button then
            button = Utils:CreateDetachedFrame("Button", nil, block)
            button:SetSize(SIZE, SIZE)
            button:SetHitRectInsets(1, 1, 1, 1)
            local ok, err = pcall(Spoken.DressBoxButton, Spoken, button)
            if ok then ok, err = pcall(button.SetBox, button, BOX, SIZE, SIZE) end
            if not ok then
                Debug:Record("tracker-play", "not dressed: " .. tostring(err))
                button:Hide()
                return
            end
            button.setPlayState = QuestOverlayUI.FollowQueue
            -- Black behind the box: the tracker sits on the world, not on a panel.
            local back = button:CreateTexture(nil, "BACKGROUND", nil, -1)
            back:SetPoint("TOPLEFT", 1, -1)
            back:SetPoint("BOTTOMRIGHT", -1, 1)
            back:SetColorTexture(0, 0, 0, 0.6)
            button:SetFrameLevel(block:GetFrameLevel() + 3)
            button:SetPoint("TOPRIGHT", block, "TOPRIGHT", 0, 0)
            buttons[block] = button
        end
        if button.questID ~= questID then button.soundData = nil end
        QuestOverlayUI:BindPlayButton(button, questID, C_QuestLog.GetTitleForQuestID(questID) or "",
            "the objective tracker's Play button")
        button:Show()
        QuestOverlayUI:SetPlayButtonState(button)
    end

    -- The blocks already drawn: the tracker lays out before the packs have loaded and before this
    -- hook, and would otherwise show no button until something redraws it.
    local function Sweep()
        for _, name in ipairs(MODULES) do
            local module = _G[name]
            for _, byTemplate in pairs(type(module) == "table" and module.usedBlocks or {}) do
                if type(byTemplate) == "table" then
                    for _, block in pairs(byTemplate) do
                        if type(block) == "table" and block.id then Dress(block) end
                    end
                end
            end
        end
    end

    local function Install()
        for _, name in ipairs(MODULES) do
            local module = _G[name]
            if type(module) == "table" and module.AddBlock and not hooked[name] then
                hooked[name] = true
                hooksecurefunc(module, "AddBlock", function(_, block) Dress(block) end)
            end
        end
        Sweep()
    end
    Install()
    QuestOverlayUI.UpdateTrackerButtons = Sweep
    -- The tracker may load after this file, and the voice packs after the tracker.
    local waiter = CreateFrame("Frame")
    waiter:RegisterEvent("PLAYER_LOGIN")
    waiter:SetScript("OnEvent", function()
        Install()
        if Spoken and Spoken.RegisterCallback then
            Spoken:RegisterCallback("VOICE_PACKS_LOADED", Sweep)
            Spoken:RegisterCallback("PART_SWITCHED", function(key) if key == "quests" then Sweep() end end)
        end
    end)
end
