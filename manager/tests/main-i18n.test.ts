import { afterEach, describe, expect, it } from 'vitest'
import { mainLanguage, setMainLanguage, t } from '../src/main/i18n'
import { CancelledError, PlainError, isAbortError, plainMessage } from '../src/main/errors'
import { linkedMessage } from '../src/main/guard'
import { checkDownloadsPath } from '../src/main/guard'

afterEach(() => setMainLanguage('enUS'))

describe('the main process speaks the chosen language', () => {
  it('English is the default, so a message built before any setting is read still reads right', () => {
    expect(mainLanguage()).toBe('enUS')
    expect(t('service.upToDate')).toBe('Spoken is up to date.')
    expect(new CancelledError().message).toBe('Cancelled.')
  })

  it('switches the words, keeping the same keys and filling the parameters', () => {
    setMainLanguage('zhCN')
    expect(t('service.upToDate')).toBe('Spoken 已是最新。')
    expect(t('service.notOnServer', { product: 'Places voices' })).toBe('语音包服务器上现在没有 Places voices。请按刷新后重试。')
    expect(t('errors.failed', { text: 'boom' })).toBe('出了点问题：boom')
  })

  it('translates what is thrown at the moment it is thrown, not when the module loaded', () => {
    // linkedMessage() and plainMessage() are the two that used to be frozen into a constant.
    expect(linkedMessage()).toContain('development checkout')
    setMainLanguage('zhCN')
    expect(linkedMessage()).toContain('链接到了开发用的检出目录')
    expect(plainMessage(new PlainError('x'))).toBe('x')
    expect(plainMessage(new Error('boom'))).toBe('出了点问题：boom')
    expect(plainMessage(new CancelledError())).toBe('已取消。')
    expect(isAbortError(new CancelledError())).toBe(true)
  })

  it('leaves a language with no dictionary on English rather than emptying the window', () => {
    setMainLanguage('zhCN')
    setMainLanguage('frFR' as never)
    expect(mainLanguage()).toBe('zhCN')
  })

  it('translates the download folder complaints it returns', () => {
    expect(checkDownloadsPath('relative/path', [], 'linux')).toBe('Choose a full folder path for downloads, such as /home/you/Downloads.')
    setMainLanguage('zhCN')
    expect(checkDownloadsPath('relative/path', [], 'linux')).toBe('请填写完整的下载文件夹路径，例如 /home/you/Downloads。')
  })
})
