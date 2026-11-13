/// <reference types="vite/client" />
import type { ManagerApi } from '@shared/api'

declare global {
  interface Window {
    /** Put there by the preload script; missing in a plain browser (the mock takes over). */
    manager?: ManagerApi
  }
}
