/**
 * A contributed English line's text from its template: `written_text` in
 * pipelines/quests/tts_cli/tts_utils.py, which is what the extract does to every line it reads.
 *
 * A contribution is stored with the reader's name, class and race put back as `$N`, `$C` and
 * `$R` (reader.ts), so it is the same kind of text the extract starts from: the template is the
 * line's `originalText`, and this is its `text`. The tokens stay for the site to say.
 *
 * Must match the Python exactly: a contributed line written one way and an extracted one another
 * would be the same corpus speaking two ways.
 */
export function writtenFromTemplate(template: string): string {
  return template.replace(/\$[bB]/g, "\n");
}
