import type { TaimioApi } from '@shared/types'

export function api(): TaimioApi {
  if (!window.taimio) {
    throw new Error('TAIMIO API недоступен. Запустите программу как приложение, а не как сайт.')
  }
  return window.taimio
}
