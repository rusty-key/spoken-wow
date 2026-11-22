/**
 * Rows per page on every audio page: quests, places, bosses and readables page alike. Fifty
 * because a quests page asks the database for each row's staleness and pronunciation marks.
 * Client-safe: the explorers read it to count pages.
 */
export const PAGE_SIZE = 50;
