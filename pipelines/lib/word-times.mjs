// A take's word times as a sound pack carries them, one string per clip: "0 .42 1.5".
//
// A Lua table per voiced line would cost every client the memory of all of them at login, and
// the captions unpack only the clip that plays. A hundredth of a second is finer than they can
// show.

/** @param times {number[]} seconds from the start of the clip, one per word */
export function packTimes(times) {
  return times
    .map((seconds) => {
      const text = seconds.toFixed(2).replace(/\.?0+$/, "");
      return text.startsWith("0.") ? text.slice(1) : text;
    })
    .join(" ");
}
