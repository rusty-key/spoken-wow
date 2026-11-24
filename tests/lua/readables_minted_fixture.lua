return function(B)
    local book = "nc0bf109d-e5d1-494d-ba1b-12a6b27352a8"
    local page = "n8dc66862-0045-43fd-81f4-a662261123e1"
    local text = "Synthetic mechanic journal fixture."
    local data = B:Data()
    data.books[book] = { title = "Gozwin's Mechanic's Log", pages = { page } }
    data.pages[page] = { book = book, number = 1, text = text }
    data.owners.item[277976] = book
    data.index["Mechanic's Log"] = { [1] = { [B:ChecksumOf(text)] = page } }
    return page
end
