import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { translations, type Lang, type TKey } from './translations'

interface I18nState {
  lang: Lang
  theme: 'light' | 'dark'
  setLang: (l: Lang) => void
  toggleLang: () => void
  toggleTheme: () => void
}

export const useI18n = create<I18nState>()(
  persist(
    (set, get) => ({
      lang: 'bn',
      theme: 'dark',
      setLang: (lang) => set({ lang }),
      toggleLang: () => set({ lang: get().lang === 'bn' ? 'en' : 'bn' }),
      toggleTheme: () => {
        const theme = get().theme === 'light' ? 'dark' : 'light'
        document.documentElement.setAttribute('data-theme', theme)
        set({ theme })
      },
    }),
    { name: 'kv-i18n' }
  )
)

export function useT() {
  const lang = useI18n((s) => s.lang)
  return (key: TKey) => translations[lang][key] ?? translations.en[key] ?? key
}

export type { Lang, TKey }
