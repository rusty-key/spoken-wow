-- The language axis of the Readables addon: which pack reads a page, which index finds it, and
-- where a report goes. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local READABLES = here .. "/../../addons/Spoken_Readables/"
local Expect, Failures = H.Expecter(print)

local PAGE, ONLY_ENGLISH = 15, 16

--- Load the addon on a client in `locale`, with the given packs installed.
local function Install(packs, locale)
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    stub.SetLocale(locale or "enUS")
    _G.SpokenReadablesSettings = nil
    _G.SpokenReadablesAudioPacks = {}
    for _, pack in ipairs(packs) do
        _G.SpokenReadablesAudioPacks[pack.addon] = { version = 1, addon = pack.addon,
            language = pack.language, pages = pack.pages, index = pack.index, loose = pack.loose,
            extraIndex = pack.extraIndex, extraLoose = pack.extraLoose, places = pack.places,
            books = pack.books }
    end
    _G.SpokenReadablesData = {
        version = 1,
        index = { ["Registry"] = { [1] = {} } },
        loose = {},
        pages = { [PAGE] = { book = 1, number = 1, text = "English first page." },
            [ONLY_ENGLISH] = { book = 1, number = 2, text = "English second page." } },
        books = { [1] = { title = "Registry", pages = { PAGE, ONLY_ENGLISH } } },
    }
    local B = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio" }) do
        assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B)
    end
    B:InitDB()
    return B
end

local ENGLISH = { addon = "SpokenReadablesAudio", pages = {
    [PAGE] = { file = "15", len = 2 }, [ONLY_ENGLISH] = { file = "16", len = 2 } } }
local GERMAN = { addon = "SpokenReadablesAudio_deDE", language = "deDE", pages = {
    [PAGE] = { file = "15", len = 2 } } }

---------------------------------------------------------------- A. the install that exists today
local B = Install({ ENGLISH })
local clip = B:ClipFor(PAGE)
Expect("A. an English pack declaring nothing reads on an English client",
    clip and clip.path, [[Interface\AddOns\SpokenReadablesAudio\Sounds\15.mp3]])
Expect("A. ...as English", clip and clip.language, "enUS")
B = Install({ ENGLISH }, "deDE")
Expect("A. a German client with only English packs still hears English",
    B:ClipFor(PAGE) and B:ClipFor(PAGE).language, "enUS")

---------------------------------------------------------------- B. the voice language, then the fallback
B = Install({ ENGLISH, GERMAN }, "deDE")
Expect("B. a German client hears the German pack", B:ClipFor(PAGE).path,
    [[Interface\AddOns\SpokenReadablesAudio_deDE\Sounds\15.mp3]])
Expect("B. a page the German pack lacks falls back to English", B:ClipFor(ONLY_ENGLISH).language, "enUS")
SpokenReadablesSettings.fallbackLanguage = "none"
Expect("B. ...and is silent with no fallback", B:ClipFor(ONLY_ENGLISH), nil)

B = Install({ ENGLISH, GERMAN }, "enUS")
Expect("B. an English client hears English", B:ClipFor(PAGE).language, "enUS")
SpokenReadablesSettings.voiceLanguage = "deDE"
Expect("B. ...unless it chose German", B:ClipFor(PAGE).language, "deDE")

---------------------------------------------------------------- C. the language the packs speak
B = Install({ ENGLISH }, "deDE")
Expect("C. a German client with only English packs hears English", B:GetPackLanguage(), "enUS")
B = Install({ ENGLISH, GERMAN }, "deDE")
Expect("C. ...and German once a German pack is installed", B:GetPackLanguage(), "deDE")

---------------------------------------------------------------- D. the page on screen, in the client's words
local GERMAN_TEXT = "Das Register der Stadt Hillsbrad."
local GERMAN_INDEX = { ["Stadtregister"] = { [1] = { [B:ChecksumOf(GERMAN_TEXT)] = PAGE } } }
local INDEXED = { addon = "SpokenReadablesAudio_deDE", language = "deDE", pages = GERMAN.pages,
    index = GERMAN_INDEX, loose = {} }
B = Install({ ENGLISH }, "deDE")
stub.ShowPage({ title = "Stadtregister", number = 1, text = GERMAN_TEXT })
Expect("D. without a German pack a German page is not recognised", B:PageOnScreen(), nil)
B = Install({ ENGLISH, INDEXED }, "deDE")
Expect("D. before it is opened, a German page is titled as the pack's index has it",
    B:ClipFor(PAGE).present.label, "Stadtregister")
B = Install({ ENGLISH, { addon = "SpokenReadablesAudio_deDE", language = "deDE", pages = GERMAN.pages } }, "deDE")
Expect("D. ...and as the corpus is where the pack has no index", B:ClipFor(PAGE).present.label, "Registry")
B = Install({ ENGLISH, INDEXED }, "deDE")
stub.ShowPage({ title = "Stadtregister", number = 1, text = GERMAN_TEXT })
Expect("D. with one, it is found by the German title and words", B:PageOnScreen(), PAGE)
Expect("D. ...and then titled as the client shows it", B:ClipFor(PAGE).present.label, "Stadtregister")
Expect("D. ...while its English fallback page keeps the English title",
    B:ClipFor(ONLY_ENGLISH).present.label, "Registry")
Expect("D. older translated packs can caption the page opened in the client",
    B:ClipFor(PAGE).present.transcript, GERMAN_TEXT)
Expect("D. a fallback page uses English captions rather than the open German page",
    B:ClipFor(ONLY_ENGLISH).present.transcript, "English second page.")
-- The client showed that page this session, but the German pack has no recording of it: the clip is
-- English, and its words are the client's, as they are for any recording on this client.
B:RememberPageText(ONLY_ENGLISH, "deDE", "Die zweite Seite.")
Expect("D. ...but not where the client showed that page: the Text Language's words, over the fallback clip",
    B:ClipFor(ONLY_ENGLISH).present.transcript, "Die zweite Seite.")
Expect("D. ...which is still the English recording", B:ClipFor(ONLY_ENGLISH).language, "enUS")
SpokenReadablesSettings.voiceLanguage = "itIT"
Expect("D. ...the same words whichever voice the fallback stands in for",
    B:ClipFor(ONLY_ENGLISH).present.transcript, "Die zweite Seite.")
Expect("D. ...and the same for the page the German pack records",
    B:ClipFor(PAGE).present.transcript, GERMAN_TEXT)
SpokenReadablesSettings.voiceLanguage = nil
local listed = B:GetAudioPacks()
Expect("D. the pack list is built once while the packs are the same", B:GetAudioPacks() == listed, true)
SpokenReadablesAudioPacks.SpokenReadablesAudio_fr = { version = 1, language = "frFR", pages = {} }
Expect("D. ...and again once a pack is added", #B:GetAudioPacks(), #listed + 1)
SpokenReadablesAudioPacks.SpokenReadablesAudio_fr = nil
Expect("D. ...and once it is removed", #B:GetAudioPacks(), #listed)
local replaced = { version = 1, addon = "SpokenReadablesAudio_deDE", language = "deDE", pages = GERMAN.pages }
SpokenReadablesAudioPacks.SpokenReadablesAudio_deDE = replaced
local after = B:GetAudioPacks()
local found = false
for _, pack in ipairs(after) do found = found or pack == replaced end
Expect("D. ...and once a pack is replaced by another of the same name", found, true)
SpokenReadablesAudioPacks.SpokenReadablesAudio_deDE = INDEXED
SpokenReadablesSettings.voiceLanguage = "enUS"
Expect("D. an English voice on a German client keeps the German words the client showed",
    B:ClipFor(PAGE).present.transcript, GERMAN_TEXT)
Expect("D. ...under the title the client showed", B:ClipFor(PAGE).present.label, "Stadtregister")
B = Install({ ENGLISH, INDEXED }, "enUS")
stub.ShowPage({ title = "Stadtregister", number = 1, text = GERMAN_TEXT })
Expect("D. ...and only on a German client", B:PageOnScreen(), nil)
B = Install({ ENGLISH, { addon = "SpokenReadablesAudio_deDE", language = "deDE", pages = GERMAN.pages,
    index = {}, loose = { [B:ChecksumOf(GERMAN_TEXT)] = PAGE } } }, "deDE")
stub.ShowPage({ title = "Ein anderer Titel", number = 1, text = GERMAN_TEXT })
Expect("D. a German checksum no other page shares is found under any title", B:PageOnScreen(), PAGE)
B = Install({ ENGLISH, { addon = "SpokenReadablesAudio_frFR", language = "frFR", pages = GERMAN.pages,
    index = GERMAN_INDEX, loose = {} } }, "deDE")
stub.ShowPage({ title = "Stadtregister", number = 1, text = GERMAN_TEXT })
Expect("D. a pack in another language is not asked", B:PageOnScreen(), nil)

---------------------------------------------------------------- E. reports
B = Install({ ENGLISH, GERMAN }, "deDE")
Expect("E. a translated page with no text never shows English under German audio",
    B:ClipFor(PAGE).present.transcript, nil)
SpokenReadablesAudioPacks.SpokenReadablesAudio_deDE.pages = { [PAGE] = {
    file = "15", len = 2, text = "Gespeicherte deutsche Seite." } }
Expect("E. new packs provide captions before a page is opened",
    B:ClipFor(PAGE).present.transcript, "Gespeicherte deutsche Seite.")
SpokenReadablesSettings.voiceLanguage = "enUS"
Expect("E. ...and the German pack's words caption the English voice on a German client",
    tostring(B:ClipFor(PAGE).language) .. " " .. tostring(B:ClipFor(PAGE).present.transcript),
    "enUS Gespeicherte deutsche Seite.")
B = Install({ ENGLISH, GERMAN }, "enUS")
SpokenReadablesAudioPacks.SpokenReadablesAudio_deDE.pages = { [PAGE] = {
    file = "15", len = 2, text = "Gespeicherte deutsche Seite." } }
SpokenReadablesSettings.voiceLanguage = "deDE"
Expect("E. a German voice on an English client is captioned in English, the Text Language",
    B:ClipFor(PAGE).present.transcript, "English first page.")
SpokenReadablesData.pages[PAGE].text = nil
Expect("E. ...and in German where English has no words for the page",
    B:ClipFor(PAGE).present.transcript, "Gespeicherte deutsche Seite.")
-- Two packs in one language, the chosen clip's with no words: the first that has them gives them.
local TWO = Install({ { addon = "SpokenReadablesAudio_a", pages = { [PAGE] = { file = "15", len = 2 } } },
    { addon = "SpokenReadablesAudio_b", pages = { [PAGE] = { file = "15", len = 2, text = "Words of pack b." } } } })
Expect("E. the first pack of a language that has a page's words gives them",
    TWO:ClipFor(PAGE).present.transcript, "Words of pack b.")
B = Install({ ENGLISH })
Expect("E. with no Spoken there is nothing to report to", B:ReportURL(PAGE), nil)
-- The address is Spoken's to build (Spoken:ReportURL); this suite loads Readables alone.
stub.LoadSpoken(here .. "/../../addons/Spoken/")
Expect("E. an English report keeps its address", B:ReportURL(PAGE, "enUS"),
    "https://spoken.rusty.one/readables/r/15")
Expect("E. ...as does one with no language", B:ReportURL(PAGE), "https://spoken.rusty.one/readables/r/15")
Expect("E. a German report goes to the German page", B:ReportURL(PAGE, "deDE"),
    "https://spoken.rusty.one/deDE/readables/r/15")
_G.Spoken, _G.SpokenEnv = nil, nil

---------------------------------------------------------------- F. a language no client runs in
-- Italian has no index of its own: the page is found by the English client's and read from
-- the Italian pack, captions included. No client runs in Italian, so its players are on an
-- English one and read along in the voice's words, not the client's.
local ITALIAN = { addon = "SpokenReadablesAudio_itIT", language = "itIT", pages = {
    [PAGE] = { file = "15", len = 2, text = "Prima pagina italiana." } } }
B = Install({ ENGLISH, ITALIAN }, "enUS")
Expect("F. on Auto an English client hears English", B:GetVoiceLanguage(), "enUS")
SpokenReadablesSettings.voiceLanguage = "itIT"
SpokenReadablesData.index["Registry"][1][B:ChecksumOf("English first page.")] = PAGE
stub.ShowPage({ title = "Registry", number = 1, text = "English first page." })
Expect("F. the English index finds the page", B:PageOnScreen(), PAGE)
Expect("F. ...and the Italian pack reads it", B:ClipFor(PAGE).language, "itIT")
Expect("F. ...captioned in the Italian pack's own words, not the English client's",
    B:ClipFor(PAGE).present.transcript, "Prima pagina italiana.")
ITALIAN.pages[PAGE].text = nil
B = Install({ ENGLISH, ITALIAN }, "enUS")
SpokenReadablesSettings.voiceLanguage = "itIT"
Expect("F. ...and in English where the Italian pack has no words for the page",
    B:ClipFor(PAGE).present.transcript, "English first page.")
B = Install({ ENGLISH, ITALIAN }, "itIT")
Expect("F. a client claiming Italian is not taken at its word", B:GetClientLanguage(), "enUS")
Expect("F. Italian is not a client language", B:IsClientLanguage("itIT"), false)

---------------------------------------------------------------- F1. the pack list
-- A pack registered before it is in this version's format is listed once it is.
B = Install({ ENGLISH })
local late = { addon = "SpokenReadablesAudio_late", pages = {} }
_G.SpokenReadablesAudioPacks.SpokenReadablesAudio_late = late
Expect("F1. a pack in no version's format is not listed", #B:GetAudioPacks(), 1)
late.version = 1
Expect("F1. ...and is once it is in this one's", #B:GetAudioPacks(), 2)

---------------------------------------------------------------- F2. a page the corpus has no words for
-- English is the Text Language, but its "" is no words: the recording's language gives them.
B = Install({ ENGLISH, { addon = "SpokenReadablesAudio_deDE", language = "deDE", pages = {
    [PAGE] = { file = "15", len = 2, text = "Deutsche Seite." } } } }, "enUS")
SpokenReadablesSettings.voiceLanguage = "deDE"
SpokenReadablesData.pages[PAGE].text = ""
Expect("F2. a page with no words in the corpus is captioned in the recording's",
    B:ClipFor(PAGE).present.transcript, "Deutsche Seite.")

---------------------------------------------------------------- G. pages only a pack has
do
    local MINTED = "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"
    local TEXT = "Trotamundos."
    local sum = Install({}, "esES"):ChecksumOf(TEXT)
    local function Pack(extra)
        local pack = { addon = "SpokenReadablesAudio_esES", language = "esES",
            pages = { [MINTED] = { file = MINTED, len = 2, text = TEXT } },
            extraIndex = { ["Instrucciones"] = { [1] = { [sum] = MINTED } } },
            extraLoose = {},
            places = { [MINTED] = { book = "n1", number = 1 } },
            books = { ["n1"] = { pages = { MINTED } } } }
        for k, v in pairs(extra or {}) do pack[k] = v end
        return pack
    end

    B = Install({ Pack() }, "esES")
    stub.ShowPage({ title = "Instrucciones", number = 1, text = TEXT })
    Expect("G. a pack with only extra pages is still asked", B:PageOnScreen(), MINTED)
    Expect("G. ...and has its audio", B:HasAudio(MINTED), true)
    local minted = B:ClipFor(MINTED)
    Expect("G. ...read from the pack's own file", minted and minted.path,
        [[Interface\AddOns\SpokenReadablesAudio_esES\Sounds\]] .. MINTED .. ".mp3")
    Expect("G. ...queued under its lineId", minted and minted.key, "b:" .. MINTED)
    Expect("G. ...titled as the client shows it", (B:ClipFor(MINTED) or {}).present.label, "Instrucciones")
    Expect("G. ...placed in the pack's book", B:PlaceOf(MINTED), "n1")
    Expect("G. ...which reads from its page", B:BookOf(MINTED).pages[1], MINTED)
    stub.LoadSpoken(here .. "/../../addons/Spoken/")
    Expect("G. ...reported by its key", B:ReportURL(MINTED, "esES"),
        "https://spoken.rusty.one/esES/readables/r/" .. MINTED)
    Expect("G. an English report of a minted page", B:ReportURL(MINTED),
        "https://spoken.rusty.one/readables/r/" .. MINTED)
    Expect("G. a string that is not a minted key has no report", B:ReportURL("../x", "esES"), nil)
    _G.Spoken, _G.SpokenEnv = nil, nil

    B = Install({ Pack({ extraIndex = {}, extraLoose = { [sum] = MINTED } }) }, "esES")
    stub.ShowPage({ title = "Otro", number = 1, text = TEXT })
    Expect("G. the pack's loose table finds it under any title", B:PageOnScreen(), MINTED)

    B = Install({ Pack({ extraIndex = false, extraLoose = false, places = false, books = false }) }, "esES")
    stub.ShowPage({ title = "Instrucciones", number = 1, text = TEXT })
    Expect("G. a pack without the extra tables finds nothing, as an older addon would", B:PageOnScreen(), nil)
    Expect("G. ...and does not place the page", B:PlaceOf(MINTED), nil)
    Expect("G. ...nor read it", B:ClipFor(MINTED), nil)

    -- A book Books.lua has, with one more page only the pack carries.
    local both = Pack({ places = { [MINTED] = { book = 1, number = 3 } },
        books = { [1] = { pages = { MINTED } } } })
    B = Install({ ENGLISH, both }, "esES")
    local pages = B:BookOf(PAGE).pages
    Expect("G. an extracted book merges its pack pages in number order",
        table.concat(pages, ","), PAGE .. "," .. ONLY_ENGLISH .. "," .. MINTED)
    Expect("G. ...whichever page it is asked from", table.concat(B:BookOf(MINTED).pages, ","),
        PAGE .. "," .. ONLY_ENGLISH .. "," .. MINTED)
    Expect("G. ...with the corpus's title", B:BookOf(MINTED).title, "Registry")
    Expect("G. ...and the corpus's list left alone", #SpokenReadablesData.books[1].pages, 2)
    both.books[1].pages = { MINTED, ONLY_ENGLISH }
    Expect("G. a page both list is not repeated", #B:BookOf(PAGE).pages, 3)
end

--------------------------------------------------------------- in step with SpokenPlaces
local readablesCodes = {}
for _, locale in ipairs(B.LOCALES) do table.insert(readablesCodes, locale.code) end
Expect("the language list matches SpokenPlaces'", table.concat(readablesCodes, " "), H.PlacesLocaleCodes(here))

---------------------------------------------------------------- what the page is on
-- Read in the reading frame, a page shows what it is on: a book from the bags its own icon, a
-- stone tablet a tablet. Queued with no frame open, it shows the book.
do
    stub.SetLocale("enUS")
    local Bk = Install({ ENGLISH })
    Expect("a page queued with no frame open shows the book", Bk:ClipFor(PAGE).present.portrait.texture,
        [[Interface\AddOns\Spoken\Textures\Book]])
    -- Open as the item text events say, not as the game's frame shows: DialogueUI hides that frame
    -- and draws its own.
    Bk.lastPage = PAGE
    _G.ItemTextGetItem = function() return "Worn Tablet" end
    _G.ItemTextGetMaterial = function() return "Stone" end
    Expect("...one on stone shows a stone tablet", Bk:ClipFor(PAGE).present.portrait.texture, Bk.MATERIALS.Stone)
    -- The bags are Spoken's to search (Spoken:BagItemIcon); this test loads Readables alone.
    local spoken = _G.Spoken
    _G.Spoken = { BagItemIcon = function(_, name) return name == "Worn Tablet" and 133741 or nil, { 0, 1, 0, 1 } end }
    Expect("...and a book from the bags its own icon", Bk:ClipFor(PAGE).present.portrait.texture, 133741)
    -- The next page of the open book is built while another is open (the one before it ends, or
    -- DialogueUI has left the game on the last): it keeps the book's picture.
    Expect("a later page of the open book keeps its icon", Bk:ClipFor(ONLY_ENGLISH).present.portrait.texture, 133741)
    Expect("...and its material", Bk:ClipFor(ONLY_ENGLISH).present.material, "Stone")
    _G.Spoken = spoken
    Bk.lastPage = nil
    _G.ItemTextGetItem, _G.ItemTextGetMaterial = nil, nil
end

---------------------------------------------------------------- the words a token page's clip says
B = Install({ ENGLISH })
SpokenReadablesData.pages[PAGE].text = "Greetings, $gbrother:sister;. $N, you are ready."
Expect("an English caption's tokens are subtitled as the clip says them",
    B:ClipFor(PAGE).present.transcript, "Greetings, brother. Adventurer, you are ready.")

stub.SetLocale("enUS")
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll readables language tests passed")
