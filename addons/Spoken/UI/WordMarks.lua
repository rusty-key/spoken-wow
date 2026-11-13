setfenv(1, SpokenEnv)

-- Finding the line being read in another window's text and marking it there, as the captions
-- mark it: the word being read lit with the one beside it, the words typed out as the voice
-- reaches them. Matching only: the caller has the window's paragraphs, draws the result, and
-- puts its text back. Feature addons reach it through Spoken:WordMarks().
--
-- A paragraph is { text, words }: its text as the window shows it and its words as
-- Spoken:SplitCaption gives them, with MarkLinks run over them.

WordMarks = {}
local Marks = WordMarks

-- How many words of the window's text a caption word may skip to find its match: a name the
-- window puts in front of the text, a hint, a word that differs.
Marks.LOOKAHEAD = 6
-- Below this share of the caption's words found, the window shows something else (an earlier
-- page, another NPC's gossip) and nothing is marked.
Marks.MIN_SHARE = 0.6
-- Gold reads on a dark page but not on tan parchment, where a deep red does.
Marks.ON_DARK = "|cffffd100"
Marks.ON_LIGHT = "|cff9c1a1a"

--- A word as compared: lower case, without ASCII punctuation. nil for all punctuation, or for
--- an escape sequence (a link, a colour): only the window's copy has those, and they must never
--- be split.
function Marks.Key(text)
    if string.find(text, "|", 1, true) then
        return nil
    end
    local key = string.gsub(string.lower(text), "%p", "")
    if key == "" then
        return nil
    end
    return key
end

--- Mark the words inside a hyperlink (|H...|h[name]|h): the name's inner words carry no escape
--- of their own, and lighting one, or typing up to it, would split the link.
function Marks.MarkLinks(text, words)
    local from = 1
    while true do
        local s, e = string.find(text, "|H.-|h.-|h", from)
        if not s then
            return words
        end
        for _, word in ipairs(words) do
            if word.last >= s and word.first <= e then
                word.inLink = true
            end
        end
        from = e + 1
    end
end

--- Every paragraph's words as compared, in one run: tokens[t] = { p, w, key }, and starts[p] the
--- first token of paragraph p (starts[n + 1] one past the last).
local function Tokens(paragraphs)
    local tokens, starts = {}, {}
    local n = table.getn(paragraphs)
    for p = 1, n do
        starts[p] = table.getn(tokens) + 1
        for w, word in ipairs(paragraphs[p].words) do
            table.insert(tokens, { p = p, w = w, key = not word.inLink and Marks.Key(word.text) or nil })
        end
    end
    starts[n + 1] = table.getn(tokens) + 1
    return tokens, starts
end

--- Match the caption's words (`keys`, theirs as compared) to the tokens from paragraph `first` on.
--- Each caption word is looked for a few words past the last match; the first only within
--- paragraph `first`. Returns map[i] = { p = paragraph, w = word } for the words found, how many
--- were found, and how many could have been.
local function AlignFrom(keys, count, tokens, starts, first)
    local firstEnd = starts[first + 1] - 1
    local map, found, counted, nextToken = {}, 0, 0, starts[first]
    local total = table.getn(tokens)
    for i = 1, count do
        local key = keys[i]
        if key then
            counted = counted + 1
            local last = math.min(total, found == 0 and firstEnd + Marks.LOOKAHEAD or nextToken + Marks.LOOKAHEAD)
            for t = nextToken, last do
                if tokens[t].key == key then
                    map[i] = tokens[t]
                    found = found + 1
                    nextToken = t + 1
                    break
                end
            end
        end
    end
    return map, found, counted
end

--- The best match over every starting paragraph, or nil when none is good enough. A window can
--- keep earlier text and a hint above the line, so the later start wins a tie. The second value
--- is the span of paragraphs matched, { first, last }: only those are typed out.
function Marks.Align(words, paragraphs)
    local tokens, starts = Tokens(paragraphs)
    local keys, count = {}, table.getn(words)
    for i = 1, count do
        keys[i] = Marks.Key(words[i].text) or false
    end
    local bestMap, bestFound, bestCounted = nil, 0, 0
    for first = 1, table.getn(paragraphs) do
        local map, found, counted = AlignFrom(keys, count, tokens, starts, first)
        if found > 0 and found >= bestFound then
            bestMap, bestFound, bestCounted = map, found, counted
        end
    end
    if not bestMap or bestFound < math.min(3, bestCounted) or bestFound < bestCounted * Marks.MIN_SHARE then
        return nil
    end
    local span
    for _, at in pairs(bestMap) do
        if not span then
            span = { first = at.p, last = at.p }
        else
            span.first, span.last = math.min(span.first, at.p), math.max(span.last, at.p)
        end
    end
    return bestMap, span
end

--- The pair to light for caption word `index`: that word, or the last one before it the window
--- has, and its neighbour in the same paragraph: the next word, or at a paragraph's end the one
--- before, as the captions keep the last pair lit at a page boundary.
function Marks.Pick(map, index)
    if not index then
        return nil
    end
    local lit = index
    while lit > 0 and not map[lit] do
        lit = lit - 1
    end
    if lit == 0 then
        return nil
    end
    local at = map[lit]
    local after, before = map[lit + 1], map[lit - 1]
    if after and after.p == at.p then
        return lit, lit + 1
    elseif before and before.p == at.p then
        return lit, lit - 1
    end
    return lit
end

--- How far the text is typed out: the paragraph the voice is in and the last byte of it shown,
--- or nil for all of it (finished, or a clip with no length to time it by). A caption word the
--- window lacks types up to the last one before it that it has.
function Marks.Cut(caption, map, span, paragraphs)
    if not caption.typewriter or not caption.progress or caption.progress >= 1 then
        return nil
    end
    local index = caption.speaking and caption.activeWord or 0
    while index > 0 and not map[index] do
        index = index - 1
    end
    if index == 0 then
        return span.first, 0
    end
    local at = map[index]
    local word = paragraphs[at.p].words[at.w]
    if caption.typewriterBy == "letter" and caption.activeWord == index then
        local count = Transcript.TypedChars(caption.progress, caption.totalWeight, caption.words[index], word.count)
        -- Whole characters: a cut inside a multibyte one would leave the window's text invalid.
        return at.p, word.first + #Transcript.Prefix(word.text, count) - 1
    end
    return at.p, word.last
end

--- `text` with the words at `spans` (sorted by position) wrapped in `color`.
function Marks.Wrap(text, spans, color)
    local parts, from = {}, 1
    for _, span in ipairs(spans) do
        table.insert(parts, string.sub(text, from, span.first - 1))
        table.insert(parts, color .. string.sub(text, span.first, span.last) .. "|r")
        from = span.last + 1
    end
    table.insert(parts, string.sub(text, from))
    return table.concat(parts)
end

--- The mark's colour on text drawn in `r`, `g`, `b`: gold on pale text (a dark page), deep red
--- on dark (a light one).
function Marks.ColorFor(r, g, b)
    local bright = (r or 1) * 0.299 + (g or 1) * 0.587 + (b or 1) * 0.114 >= 0.5
    return bright and Marks.ON_DARK or Marks.ON_LIGHT
end

--- What paragraph `p` should show: its text typed out to `cutByte` in `cutP` within `span`, the
--- words at `spans[p]` that are already typed wrapped in `color`. `cutP` nil shows it whole.
function Marks.Want(para, p, span, cutP, cutByte, spans, color)
    local want = para.text
    if cutP and p >= span.first and p <= span.last then
        if p > cutP then
            want = ""
        elseif p == cutP then
            want = string.sub(para.text, 1, cutByte)
        end
    end
    if spans and spans[p] then
        -- Only words already typed: the neighbour past the voice is not shown yet.
        local shown, kept = string.len(want), {}
        for _, word in ipairs(spans[p]) do
            if word.last <= shown then
                table.insert(kept, word)
            elseif word.first <= shown then
                -- By letter, the active word is partly typed: light only what is shown.
                table.insert(kept, { first = word.first, last = shown })
            end
        end
        table.sort(kept, function(a, b) return a.first < b.first end)
        want = Marks.Wrap(want, kept, color)
    end
    return want
end

--- The lit pair's words by paragraph, for Want.
function Marks.Spans(map, paragraphs, lit, neighbor)
    local spans = {}
    for _, index in ipairs({ lit, neighbor }) do
        local at = map[index]
        if at then
            spans[at.p] = spans[at.p] or {}
            table.insert(spans[at.p], paragraphs[at.p].words[at.w])
        end
    end
    return spans
end
