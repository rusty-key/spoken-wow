import { useId, useState, type ReactNode } from 'react'
import { languageName } from '@shared/products'
import { useStore } from '../store'

/** The chosen language, falling back to the first when the account no longer holds it. */
export function useLanguageTab(langs: string[]): [string, (lang: string) => void] {
  const [lang, setLang] = useState('')
  return [langs.includes(lang) ? lang : (langs[0] ?? ''), setLang]
}

export function LanguageTabs({ langs, value, onChange, label, children }: { langs: string[]; value: string; onChange: (lang: string) => void; label: string; children: ReactNode }): ReactNode {
  const id = useId()
  const { state } = useStore()
  // A team's language (itIT) is named only by the channel's index.
  const name = (code: string): string => state.languages.find((l) => l.code === code)?.name ?? languageName(code)
  return (
    <>
      <div className="subtabs subtabs-wrap" role="tablist" aria-label={label}>
        {langs.map((l) => (
          <button key={l} type="button" role="tab" id={`${id}-${l}`} aria-selected={value === l} aria-controls={`${id}-panel`} className="subtab" onClick={() => onChange(l)}>
            {name(l)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} className="contrib-store">
        {children}
      </div>
    </>
  )
}
