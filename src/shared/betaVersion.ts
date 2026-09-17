/** Semver из package.json → подпись Beta для UI и имён Update. 0.2.0 → 0.2 */
export function formatBetaVersion(semver: string): string {
  const match = String(semver)
    .trim()
    .match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return semver
  const patch = match[3] ?? '0'
  return patch === '0' ? `${match[1]}.${match[2]}` : `${match[1]}.${match[2]}.${patch}`
}

export function betaProductLabel(semver: string): string {
  return `TAIMIO Beta ${formatBetaVersion(semver)}`
}
