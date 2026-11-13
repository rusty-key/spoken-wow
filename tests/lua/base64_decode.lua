-- A standard (padded) base64 decoder, for verifying Contribute:Base64URL from the outside.
--
-- Deliberately separate arithmetic from Contribute.lua's encoder: a round trip that decodes
-- with the same code that encoded would pass even if both sides shared the same bug. This is
-- the independent half of that check, over the RFC 4648 alphabet rather than the url-safe one
-- -- the test that uses this swaps '-'/'_' back to '+'/'/' and restores padding before calling it.
local STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local VALUE = {}
for i = 1, #STD do
    VALUE[STD:sub(i, i)] = i - 1
end

local floor = math.floor

return function(encoded)
    encoded = encoded:gsub("=+$", "")
    local out = {}
    local i = 1
    local n = #encoded
    while i <= n do
        local c1, c2, c3, c4 = encoded:sub(i, i), encoded:sub(i + 1, i + 1), encoded:sub(i + 2, i + 2), encoded:sub(i + 3, i + 3)
        local v1, v2 = VALUE[c1], VALUE[c2]
        local v3 = c3 ~= "" and VALUE[c3] or nil
        local v4 = c4 ~= "" and VALUE[c4] or nil
        local group = v1 * 262144 + v2 * 4096 + (v3 or 0) * 64 + (v4 or 0)
        out[#out + 1] = string.char(floor(group / 65536) % 256)
        if v3 then
            out[#out + 1] = string.char(floor(group / 256) % 256)
        end
        if v4 then
            out[#out + 1] = string.char(group % 256)
        end
        i = i + 4
    end
    return table.concat(out)
end
