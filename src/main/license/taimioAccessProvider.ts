import { app } from 'electron'
import { ACCESS_CONFIG } from '../../shared/accessConfig'
import { looksLikeAdminKey, looksLikeOfflineKey, maskAccessKey, normalizeTypedKey } from '../../shared/accessCodec'
import { daysUntil, type LicenseRefreshReason, type LicenseSnapshot, type LicenseState } from '../../shared/license'
import type { AppPaths } from '../paths'
import type { LicenseProvider } from './licenseProvider'
import { clearAccessEnvelope, readAccessEnvelope, writeAccessEnvelope, type AccessEnvelope } from './accessStore'
import { getOrCreateDeviceId } from './deviceId'
import { adminKeyId, parseAdminKey } from './adminKey'
import { offlineKeyId, parseOfflineKey } from './offlineKey'
import { AccessClientError, activateOnlineKey, checkOnlineKey } from './onlineKey'

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function emptySnapshot(): LicenseSnapshot {
  return {
    state: 'not_activated',
    plan: null,
    licenseKeyMasked: null,
    activatedAt: null,
    expiresAt: null,
    daysLeft: null,
    graceEndsAt: null,
    lastCheckedAt: null,
    offline: true,
    source: 'cached'
  }
}

export class TaimioAccessProvider implements LicenseProvider {
  constructor(private readonly paths: AppPaths) {}

  async getSnapshot(): Promise<LicenseSnapshot> {
    return this.snapshotFromEnvelope(readAccessEnvelope(this.paths), 'startup')
  }

  async refresh(reason: LicenseRefreshReason = 'manual'): Promise<LicenseSnapshot> {
    const envelope = readAccessEnvelope(this.paths)
    if (!envelope) return emptySnapshot()
    if (envelope.plan === 'admin') {
      return this.snapshotFromEnvelope(envelope, 'offline')
    }
    if (envelope.plan === 'beta_offline') {
      return this.snapshotFromEnvelope(this.touchOffline(envelope), 'cached')
    }
    if (reason === 'manual' || this.shouldCheckOnline(envelope)) {
      try {
        const checked = await checkOnlineKey({
          keyId: envelope.keyId,
          deviceId: envelope.deviceId,
          appVersion: app.getVersion()
        })
        const next: AccessEnvelope = {
          ...envelope,
          status: checked.claims.status === 'not_activated' ? 'active' : checked.claims.status,
          expiresAt: checked.claims.expiresAt ?? envelope.expiresAt,
          activatedAt: checked.claims.activatedAt ?? envelope.activatedAt,
          lastCheckedAt: new Date().toISOString(),
          lastTrustedLocalAt: new Date().toISOString(),
          serverToken: checked.token
        }
        writeAccessEnvelope(this.paths, next)
        return this.snapshotFromEnvelope(next, 'server')
      } catch (error) {
        if (error instanceof AccessClientError && error.code === 'blocked') {
          const blocked = { ...envelope, status: 'blocked' as const, lastCheckedAt: new Date().toISOString() }
          writeAccessEnvelope(this.paths, blocked)
          return this.snapshotFromEnvelope(blocked, 'server')
        }
        if (error instanceof AccessClientError && error.code === 'expired') {
          const expired = { ...envelope, status: 'expired' as const, lastCheckedAt: new Date().toISOString() }
          writeAccessEnvelope(this.paths, expired)
          return this.snapshotFromEnvelope(expired, 'server')
        }
        return this.snapshotFromEnvelope(envelope, reason === 'manual' ? 'cached' : 'startup')
      }
    }
    return this.snapshotFromEnvelope(envelope, 'cached')
  }

  async clear(): Promise<LicenseSnapshot> {
    clearAccessEnvelope(this.paths)
    return emptySnapshot()
  }

  async activate(licenseKey: string): Promise<LicenseSnapshot> {
    const typed = normalizeTypedKey(licenseKey)
    if (!typed) throw new Error('Введите ключ доступа.')
    const deviceId = getOrCreateDeviceId(this.paths)
    if (looksLikeAdminKey(typed)) return this.activateAdmin(typed, deviceId)
    if (looksLikeOfflineKey(typed)) return this.activateOffline(typed, deviceId)
    return this.activateOnline(typed, deviceId)
  }

  private activateAdmin(typed: string, deviceId: string): LicenseSnapshot {
    const parsed = parseAdminKey(typed)
    const existing = readAccessEnvelope(this.paths)
    if (existing?.plan === 'admin' && existing.keyId === adminKeyId(parsed.serial)) {
      return this.snapshotFromEnvelope(existing, 'offline')
    }
    const activatedAt = new Date().toISOString()
    const envelope: AccessEnvelope = {
      v: 1,
      plan: 'admin',
      keyId: adminKeyId(parsed.serial),
      keyMasked: maskAccessKey(typed),
      activatedAt,
      expiresAt: null,
      deviceId,
      lastCheckedAt: activatedAt,
      lastTrustedLocalAt: activatedAt,
      status: 'active',
      offlineSerial: parsed.serial
    }
    writeAccessEnvelope(this.paths, envelope)
    return this.snapshotFromEnvelope(envelope, 'offline')
  }

  private activateOffline(typed: string, deviceId: string): LicenseSnapshot {
    const parsed = parseOfflineKey(typed)
    const existing = readAccessEnvelope(this.paths)
    if (existing?.plan === 'beta_offline' && existing.keyId === offlineKeyId(parsed.serial)) {
      return this.snapshotFromEnvelope(this.touchOffline(existing), 'offline')
    }
    const activatedAt = new Date().toISOString()
    const envelope: AccessEnvelope = {
      v: 1,
      plan: 'beta_offline',
      keyId: offlineKeyId(parsed.serial),
      keyMasked: maskAccessKey(typed),
      activatedAt,
      expiresAt: addDays(activatedAt, parsed.durationDays),
      deviceId,
      lastCheckedAt: activatedAt,
      lastTrustedLocalAt: activatedAt,
      status: 'active',
      offlineSerial: parsed.serial
    }
    writeAccessEnvelope(this.paths, envelope)
    return this.snapshotFromEnvelope(envelope, 'offline')
  }

  private async activateOnline(typed: string, deviceId: string): Promise<LicenseSnapshot> {
    const existing = readAccessEnvelope(this.paths)
    const result = await activateOnlineKey({
      key: typed,
      deviceId,
      appVersion: app.getVersion()
    })
    const envelope: AccessEnvelope = {
      v: 1,
      plan: 'beta',
      keyId: result.claims.keyId,
      keyMasked: maskAccessKey(typed),
      activatedAt: result.claims.activatedAt ?? existing?.activatedAt ?? new Date().toISOString(),
      expiresAt: result.claims.expiresAt ?? existing?.expiresAt ?? addDays(new Date().toISOString(), ACCESS_CONFIG.durationDays),
      deviceId,
      lastCheckedAt: new Date().toISOString(),
      lastTrustedLocalAt: new Date().toISOString(),
      status: result.claims.status === 'not_activated' ? 'active' : result.claims.status,
      serverToken: result.token
    }
    writeAccessEnvelope(this.paths, envelope)
    return this.snapshotFromEnvelope(envelope, 'server')
  }

  private touchOffline(envelope: AccessEnvelope): AccessEnvelope {
    const next = { ...envelope, lastTrustedLocalAt: this.trustedNow(envelope) }
    if (next.expiresAt && Date.parse(next.lastTrustedLocalAt) >= Date.parse(next.expiresAt)) {
      next.status = 'expired'
    }
    writeAccessEnvelope(this.paths, next)
    return next
  }

  private trustedNow(envelope: AccessEnvelope): string {
    const now = Date.now()
    const trusted = Date.parse(envelope.lastTrustedLocalAt)
    const skew = ACCESS_CONFIG.clockSkewMinutes * 60_000
    if (Number.isFinite(trusted) && now + skew < trusted) return envelope.lastTrustedLocalAt
    return new Date(Math.max(now, trusted || 0)).toISOString()
  }

  private shouldCheckOnline(envelope: AccessEnvelope): boolean {
    const last = Date.parse(envelope.lastCheckedAt)
    if (!Number.isFinite(last)) return true
    return Date.now() - last >= ACCESS_CONFIG.periodicCheckHours * 3600_000
  }

  private snapshotFromEnvelope(
    envelope: AccessEnvelope | null,
    source: LicenseSnapshot['source'] | LicenseRefreshReason
  ): LicenseSnapshot {
    if (!envelope) return emptySnapshot()
    if (envelope.plan === 'admin') {
      return {
        state: 'active',
        plan: 'admin',
        licenseKeyMasked: envelope.keyMasked,
        activatedAt: envelope.activatedAt,
        expiresAt: null,
        daysLeft: null,
        graceEndsAt: null,
        lastCheckedAt: envelope.lastCheckedAt,
        offline: true,
        source: 'offline'
      }
    }
    const nowIso = envelope.plan === 'beta_offline' ? this.trustedNow(envelope) : new Date().toISOString()
    const now = Date.parse(nowIso)
    const expires = envelope.expiresAt ? Date.parse(envelope.expiresAt) : Number.NaN
    let state: LicenseState = envelope.status
    let graceEndsAt: string | null = null
    if (envelope.status === 'active' && Number.isFinite(expires) && now >= expires) {
      state = 'expired'
    } else if (envelope.plan === 'beta' && envelope.status === 'active') {
      const last = Date.parse(envelope.lastCheckedAt)
      const stale = !Number.isFinite(last) || now - last > ACCESS_CONFIG.periodicCheckHours * 3600_000
      if (stale) {
        const graceEnd = (Number.isFinite(last) ? last : now) + ACCESS_CONFIG.gracePeriodHours * 3600_000
        graceEndsAt = new Date(graceEnd).toISOString()
        state = now > graceEnd ? 'expired' : 'grace_period'
      }
    }
    const resolvedSource =
      source === 'server' || source === 'offline' || source === 'cached' || source === 'stub'
        ? source
        : envelope.plan === 'beta_offline'
          ? 'offline'
          : 'cached'
    return {
      state,
      plan: envelope.plan,
      licenseKeyMasked: envelope.keyMasked,
      activatedAt: envelope.activatedAt,
      expiresAt: envelope.expiresAt,
      daysLeft: daysUntil(envelope.expiresAt, now),
      graceEndsAt,
      lastCheckedAt: envelope.lastCheckedAt,
      offline: envelope.plan === 'beta_offline' || resolvedSource === 'cached',
      source: resolvedSource
    }
  }
}
