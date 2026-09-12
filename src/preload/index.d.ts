import type { TaimioApi } from '../shared/types'

declare global {
  interface Window {
    taimio: TaimioApi
  }
}

export {}
