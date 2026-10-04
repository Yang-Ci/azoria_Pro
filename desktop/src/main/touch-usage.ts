import type { CodexQuotaData } from "../shared/usage"
import { makeTouchUsage } from "../shared/touch-usage"
import type { CodexQuotaService } from "./codex-quota"
import type { UsageProviderStore } from "./usage-provider-store"
import type { ApiUsageService } from "./api-usage"

export class TouchUsageService {
  private quota: CodexQuotaData | null = null
  private quotaCheckedAt = 0
  private timer?: NodeJS.Timeout
  private pending?: Promise<void>
  private stopped = false

  constructor(private readonly codex: CodexQuotaService, private readonly store: UsageProviderStore, private readonly api: ApiUsageService) {}

  start(): void {
    this.stopped = false
    void this.tick()
    this.timer = setInterval(() => void this.tick(), 30_000)
    this.timer.unref()
  }

  stop(): void { this.stopped = true; clearInterval(this.timer) }

  private tick(): Promise<void> {
    if (this.pending) return this.pending
    this.pending = (async () => {
      if (this.stopped) return
      if (Date.now() - this.quotaCheckedAt >= 60_000) {
        this.quotaCheckedAt = Date.now()
        try { this.quota = await this.codex.collect() } catch { /* Preserve last successful local sample. */ }
      }
      const providers = await this.store.list()
      await Promise.allSettled(providers.filter(provider => provider.config.enabled &&
        Date.now() - (provider.checkedAt ? Date.parse(provider.checkedAt) : 0) >= provider.config.refreshMinutes * 60_000
      ).map(provider => this.api.refresh(provider.config.id)))
    })().catch(() => undefined).finally(() => { this.pending = undefined })
    return this.pending
  }

  async snapshot(index = 0) {
    // LAN/BLE reads never wait on a provider's network request.
    return makeTouchUsage(this.quota, await this.store.list(), index)
  }
}
