local _, Developer = ...

local L = Developer.L
local Spoken = Developer:Spoken()
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end
local Text = {}
Developer.Text = Text

local ICON = [[Interface\Icons\INV_Misc_ScrollUnrolled01]]
local HOSTS = { "QuestFrame", "GossipFrame", "ItemTextFrame", "DUIQuestFrame", "DUIBookFrame" }

local function Visible(frame)
	return frame and frame:IsVisible()
end

local function Add(lines, name, value)
	value = NotSecret(value)
	if value ~= nil and value ~= "" then
		lines[#lines + 1] = format("[%s: %s]", name, tostring(value))
	end
end

function Text:IsOn()
	return Developer:DB().copyText == true
end

function Text:Current()
	if not self:IsOn() then return nil end
	-- DialogueUI already supplies a copy control on both kinds of window.
	if Visible(_G.DUIQuestFrame) or Visible(_G.DUIBookFrame) then return nil end
	local books = _G.SpokenReadables
	local frame, kind, text
	if Visible(_G.ItemTextFrame) and books and not books:IsMail() then
		frame, kind, text = ItemTextFrame, "readables", NotSecret(ItemTextGetText())
	else
		local quests = _G.VoiceOver
		if not (quests and quests.Contribute and quests.Contribute.CurrentText) then return nil end
		frame = Visible(_G.QuestFrame) and QuestFrame or Visible(_G.GossipFrame) and GossipFrame or nil
		kind, text = "quests", frame and quests.Contribute:CurrentText()
	end
	if type(text) ~= "string" or text == "" then return nil end
	return frame, kind, text
end

local function QuestItems(lines, source, count)
	for index = 1, count or 0 do
		local hidden = IsQuestItemHidden and IsQuestItemHidden(index)
		local name, _, quantity, _, _, id = GetQuestItemInfo(source, index)
		id, name, quantity = NotSecret(id), NotSecret(name), NotSecret(quantity)
		if not id and GetQuestItemLink then
			local link = NotSecret(GetQuestItemLink(source, index))
			id = link and tonumber(string.match(link, "item:(%d+)"))
		end
		if id and hidden ~= 1 then
			Add(lines, "ItemID", tostring(id) .. (name and " " .. name or "")
				.. (quantity and quantity > 1 and format(" x%d", quantity) or ""))
		end
	end
end

local function NPCDetails(lines)
	local greeting = Visible(_G.QuestFrameGreetingPanel)
	if greeting then
		local guid = VoiceOver.Utils:GetNPCGUID()
		Add(lines, "NPC", VoiceOver.Utils:ReadIDFromGUID(guid))
		Add(lines, "Name", VoiceOver.Utils:GetNPCName())
		Add(lines, "event", "greeting")
		if GetNumAvailableQuests and GetAvailableQuestInfo then
			for index = 1, GetNumAvailableQuests() or 0 do
				local _, _, _, _, id = GetAvailableQuestInfo(index)
				Add(lines, "Available Quest", id)
			end
		end
		if GetNumActiveQuests and GetActiveQuestID then
			for index = 1, GetNumActiveQuests() or 0 do Add(lines, "Active Quest", GetActiveQuestID(index)) end
		end
	end
	if Visible(_G.QuestFrameProgressPanel) and GetQuestItemInfo and GetNumQuestItems then
		QuestItems(lines, "required", GetNumQuestItems())
	elseif Visible(_G.QuestFrameRewardPanel) and GetQuestItemInfo then
		if GetNumQuestChoices then QuestItems(lines, "choice", GetNumQuestChoices()) end
		if GetNumQuestRewards then QuestItems(lines, "reward", GetNumQuestRewards()) end
	end
	if Visible(_G.GossipFrame) and C_GossipInfo and C_GossipInfo.GetOptions then
		for _, option in ipairs(C_GossipInfo.GetOptions() or {}) do
			local id, name = NotSecret(option.gossipOptionID), NotSecret(option.name)
			if id then Add(lines, "OptionID", tostring(id) .. (name and " " .. name or "")) end
		end
	end
end

function Text:Payload(kind, text)
	local envelope, key
	if kind == "readables" then
		envelope, key = SpokenReadables:CaptureContribution()
	elseif not Visible(_G.QuestFrameGreetingPanel) then
		-- On a greeting, Capture can only find the last gossip, which the API still answers with.
		envelope, key = VoiceOver.Contribute:Capture()
	end
	local lines = {}
	local _, fields = Spoken.Contribute:Parse(envelope)
	for _, field in ipairs(fields or {}) do Add(lines, field[1], field[2]) end
	Add(lines, "Spoken key", key)
	if kind == "readables" then
		local id = SpokenReadables:PageOnScreen()
		Add(lines, "ReadableID", id)
		Add(lines, "BookID", id and SpokenReadables:PlaceOf(id))
		for _, opener in ipairs(SpokenReadables.openedBy or {}) do
			if opener.kind == "object" then Add(lines, "object", opener.id) end
		end
	else
		NPCDetails(lines)
	end
	lines[#lines + 1] = ""
	lines[#lines + 1] = text
	return table.concat(lines, "\n")
end

function Text:Show()
	local frame, kind, text = self:Current()
	if not frame then return end
	Developer.Box:Show(self:Payload(kind, text), L.BOX_TITLE_TEXT, frame, self)
end

function Text:Watch(frame)
	if not frame or self.watched[frame] then return end
	self.watched[frame] = true
	for _, script in ipairs({ "OnShow", "OnHide" }) do
		frame:HookScript(script, function() self:Refresh() end)
	end
end

function Text:Position(frame, kind)
	local anchor
	local function Beside(control)
		if control then
			self:Watch(control)
			if not anchor and control:IsVisible() then anchor = control end
		end
	end
	if kind == "readables" then
		Beside(SpokenReadables.openButton)
		Beside(SpokenReadables.playButton)
	else
		local quests = VoiceOver
		Beside(quests.QuestsTab and quests.QuestsTab.giverButton)
		Beside(quests.DialogPlayButton and quests.DialogPlayButton.muteButton)
		Beside(quests.ContributeButton and quests.ContributeButton.button)
		Beside(quests.DialogPlayButton and quests.DialogPlayButton.button)
	end
	local button = self.button
	button:SetParent(frame)
	button:ClearAllPoints()
	if anchor then
		button:SetPoint("RIGHT", anchor, "LEFT", -4, 0)
	else
		button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -40, -32)
	end
end

function Text:Refresh()
	local frame, kind = self:Current()
	if not frame then
		if self.button then self.button:Hide() end
		return
	end
	if not self.button then
		local button = Spoken:CreateRoundButton(frame, "icon", nil, ICON)
		button:SetSize(24, 24)
		button:SetScript("OnClick", function() self:Show() end)
		button:HookScript("OnEnter", function(control)
			GameTooltip:SetOwner(control, "ANCHOR_RIGHT")
			GameTooltip:SetText(L.OPT_COPY_TEXT)
			GameTooltip:Show()
		end)
		button:HookScript("OnLeave", function() GameTooltip:Hide() end)
		self.button = button
	end
	self:Position(frame, kind)
	self.button:Show()
end

local function SetOn(value)
	Developer:DB().copyText = value and true or false
	Text:Refresh()
	if not Text:IsOn() then Developer.Box:Hide(Text) end
end

function Text:Setup()
	if self.watcher then return end
	self.watched = {}
	local watcher = CreateFrame("Frame")
	for _, event in ipairs({ "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_GREETING",
		"GOSSIP_SHOW", "GOSSIP_CLOSED", "QUEST_FINISHED", "ITEM_TEXT_READY", "ITEM_TEXT_CLOSED", "ADDON_LOADED" }) do
		watcher:RegisterEvent(event)
	end
	local function Sync()
		for _, name in ipairs(HOSTS) do
			self:Watch(_G[name])
		end
		self:Refresh()
	end
	watcher:SetScript("OnEvent", Sync)
	self.watcher = watcher
	Sync()
end

if Spoken then
	Spoken:AddDeveloperSettings(function(layout)
		layout:Checkbox(L.OPT_COPY_TEXT, nil, function() return Text:IsOn() end, SetOn)
		return function() SetOn(false) end
	end, "testing", 0)
end
