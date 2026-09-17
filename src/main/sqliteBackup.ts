import { copyFileSync, existsSync } from 'fs'

export const CATALOG_SCHEMA_VERSION = 1
export const PROJECT_SCHEMA_VERSION = 1

export function backupSqliteFile(filePath: string): void {
  if (!existsSync(filePath)) return
  copyFileSync(filePath, `${filePath}.bak`)
}
