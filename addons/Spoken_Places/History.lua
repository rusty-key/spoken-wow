-- The client's exploration and SavedVariablesPerCharacter belong to one character. Keep that
-- record intact when sharing is off, and only fold it into the account record when asked.
local _, SpokenPlaces = ...

local merged = {}

local function Character()
	if type(SpokenPlacesCharacter) ~= "table" then SpokenPlacesCharacter = {} end
	return SpokenPlacesCharacter
end

local function Account()
	if type(SpokenPlacesAccountHistory) ~= "table" then SpokenPlacesAccountHistory = {} end
	return SpokenPlacesAccountHistory
end

local function Set(db, kind)
	if type(db[kind]) ~= "table" then db[kind] = {} end
	return db[kind]
end

function SpokenPlaces:SharesHistory()
	return type(SpokenPlacesAccountHistory) == "table"
		and SpokenPlacesAccountHistory.shared == true
end

function SpokenPlaces:SetSharesHistory(on)
	Account().shared = on and true or false
	-- Changes made while sharing was off must be included when it is enabled again.
	merged = {}
	if on then
		self:MergeHistory()
		-- The map might have been scanned before the switch was enabled. Export that
		-- cache now instead of waiting for the next world-map refresh.
		if self.ShareCachedExploration then self:ShareCachedExploration() end
	end
end

-- A returning character's existing records must be visible to alts even if they do not
-- enter a new place this session.
function SpokenPlaces:MergeHistory()
	if not self:SharesHistory() then return end
	self:HistorySet("heard")
	self:HistorySet("readAt")
	self:HistorySet("visited")
end

function SpokenPlaces:HistorySet(kind)
	local character = Character()
	local own = Set(character, kind)
	if not self:SharesHistory() then return own end
	local account = Account()
	local shared = Set(account, kind)
	if merged[kind] ~= own then
		-- Forget Visited Places clears the account's history. An alt that has not logged in
		-- since then must not silently restore its old heard list on the next login.
		local resetAt = kind ~= "visited" and account.heardResetAt
		for key, value in pairs(own) do
			local heardAt = character.readAt and character.readAt[key]
			if not resetAt or (type(heardAt) == "number" and heardAt >= resetAt) then
				if kind == "readAt" then
					if type(value) == "number" and
						(type(shared[key]) ~= "number" or value > shared[key]) then
						shared[key] = value
					end
				elseif value == true then
					shared[key] = true
				end
			end
		end
		merged[kind] = own
	end
	return shared
end

function SpokenPlaces:RememberHistory(kind, key, value)
	local shared = self:SharesHistory() and self:HistorySet(kind)
	Set(Character(), kind)[key] = value
	if shared then shared[key] = value end
end

function SpokenPlaces:ForgetHeardHistory()
	local character = Character()
	character.greeted, character.heard, character.readAt = nil, nil, nil
	if self:SharesHistory() then
		local account = Account()
		account.heard, account.readAt = nil, nil
		account.heardResetAt = (time or os.time)()
	end
end
