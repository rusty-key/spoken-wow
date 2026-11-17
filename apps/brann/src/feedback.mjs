// The buttons under Brann's answers, and the asker's verdict on an answer. The verdict is kept in
// the answer itself: once the asker presses 👍 or 👎, the two buttons become one disabled button
// saying which. Nothing is stored anywhere else, and the weekly FAQ sweep (sweep.mjs) reads it
// back off the message.
//
// Components are the API's JSON, which discord.js sends as it is and the REST API returns.

export const DM_BUTTON = "brann:dm";
export const HELPED = "brann:fb:up";
export const NOT_HELPED = "brann:fb:down";
const MARKED_HELPED = "Marked helpful";
const MARKED_NOT_HELPED = "Marked not helpful";

const BUTTON = 2;
const ROW = 1;
const SECONDARY = 2;
const SUCCESS = 3;
const DANGER = 4;

const button = (custom_id, label, style, extra = {}) => ({ type: BUTTON, custom_id, label, style, ...extra });

const dmButton = () => button(DM_BUTTON, "Continue in DMs", SECONDARY);

/** The row under an answer: 👍, 👎 and Continue in DMs. */
export function answerComponents() {
  return [{
    type: ROW,
    components: [
      button(HELPED, "Helped", SECONDARY, { emoji: { name: "👍" } }),
      button(NOT_HELPED, "Didn't help", SECONDARY, { emoji: { name: "👎" } }),
      dmButton(),
    ],
  }];
}

/** The row after the asker's verdict: the verdict, disabled, and Continue in DMs. */
export function ratedComponents(helped) {
  return [{
    type: ROW,
    components: [
      helped
        ? button(HELPED, MARKED_HELPED, SUCCESS, { disabled: true, emoji: { name: "👍" } })
        : button(NOT_HELPED, MARKED_NOT_HELPED, DANGER, { disabled: true, emoji: { name: "👎" } }),
      dmButton(),
    ],
  }];
}

const buttonsOf = (components) => (components ?? []).flatMap((row) => row.components ?? []);

/** An answer's verdict: "helped", "not helped", "unrated" (buttons still there), or null for no buttons. */
export function verdictOf(components) {
  const buttons = buttonsOf(components);
  if (buttons.some((b) => b.disabled && b.custom_id === HELPED)) return "helped";
  if (buttons.some((b) => b.disabled && b.custom_id === NOT_HELPED)) return "not helped";
  if (buttons.some((b) => b.custom_id === HELPED)) return "unrated";
  return null;
}

/** Who may rate an answer: the player it mentions first, else whoever opened the thread it is in. */
export function askerOf(content, threadStarterId) {
  return content.match(/^<@!?(\d+)>/)?.[1] ?? threadStarterId ?? null;
}
