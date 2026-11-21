setfenv(1, VoiceOver)
local function jaccardSimilarity(a, b)
    local tokens_a, tokens_b = {}, {}
    for token in string.gmatch(a, "%S+") do tokens_a[token] = true end
    for token in string.gmatch(b, "%S+") do tokens_b[token] = true end

    local intersection, union = 0, 0
    for token in pairs(tokens_a) do
        union = union + 1
        if tokens_b[token] then
            intersection = intersection + 1
        end
    end
    for token in pairs(tokens_b) do
        if not tokens_a[token] then
            union = union + 1
        end
    end

    return intersection / union
end

---@param query string
---@param tableVar table<string, any>
---@param keyText fun(key: string): string? what a key is compared as, the key itself by default
function FuzzySearchBestKeys(query, tableVar, keyText)
    local best_result = nil
    local max_similarity = -1

    for entry, value in pairs(tableVar) do
        local similarity = jaccardSimilarity(query, keyText and keyText(entry) or entry)
        if similarity > max_similarity then
            max_similarity = similarity
            best_result = {
                value = value,
                text = entry,
                similarity = similarity
            }
        end
    end

    return best_result
end