// Which items and objects tell a page apart. Shared by the export and the site's matcher.

/**
 * The Plain Letter a letter becomes when it is taken out of the mailbox. Every copy is this one
 * item with its own words, so neither the item nor its name tells one letter from another.
 */
export const LETTER_COPY_ITEM = 8383;

/**
 * Whether an owner names one book, as every owner but the letter copy does.
 *
 * @param {"object" | "item"} kind
 * @param {number} id
 * @returns {boolean}
 */
export function namesOneBook(kind, id) {
  return !(kind === "item" && id === LETTER_COPY_ITEM);
}
