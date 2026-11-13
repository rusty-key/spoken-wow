import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SpokenStatus } from '../src/renderer/src/components/SpokenStatus'
import { setUiLanguage } from '../src/renderer/src/strings'

/** Draws real components: the words a player sees, after a language switch, as HTML. */
describe('the window draws the chosen language', () => {
  it('renders a status line in Chinese, then back in English', () => {
    setUiLanguage('zhCN')
    const zh = renderToStaticMarkup(createElement(SpokenStatus, { status: undefined }))
    expect(zh).toContain('未安装 Spoken')

    setUiLanguage('enUS')
    const en = renderToStaticMarkup(createElement(SpokenStatus, { status: undefined }))
    expect(en).toContain('Spoken not installed')
    expect(en).not.toContain('未安装')
  })

  it('fills a parameterised sentence in the right language', () => {
    setUiLanguage('zhCN')
    const html = renderToStaticMarkup(
      createElement(SpokenStatus, {
        status: { productId: 'spoken', gameId: 'g', installedFolders: [], state: 'up-to-date', installedVersion: '3.5.0' }
      })
    )
    expect(html).toContain('Spoken 3.5.0 · 已是最新')
  })
})
