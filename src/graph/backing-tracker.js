/**
 * Tracks order backing: owner's token balance, trustline authorization, receive headroom and the allowance
 * granted to the AXIS contract. The contract holds no funds between calls, so an open order is fillable only up to
 * `min(balance, allowance)` shared across all orders of the maker selling that asset. A fill the maker cannot back is
 * skipped by the contract (`skip` event), which the tracker records per (owner, asset sold). The record of the asset a
 * maker receives tells whether the maker can be paid: a missing or deauthorized trustline is skipped, while a payment
 * beyond the headroom (a full trustline) fails the whole call.
 *
 * Records are either polled (`loader` + periodic sweeps + event-driven reloads) or pushed by in a stream mode.
 */
class BackingTracker {
    /**
     * @param {BackingLoader} [loader] - Async function loading the backing of an account in a token
     * @param {BackingTrackerOptions} [options]
     */
    constructor(loader, {refreshInterval = 60_000, staleAfter = 300_000, concurrency = 4, recheckDelay = 30_000, onChange, stream} = {}) {
        this.loader = loader
        this.refreshInterval = refreshInterval
        this.staleAfter = staleAfter
        this.concurrency = concurrency
        this.recheckDelay = stream ? 0 : recheckDelay //streamed state does not lag the events
        this.onChange = onChange
        this.stream = stream
    }

    /**
     * Called when a record's balance, allowance, allowance lifetime, authorization or `pending` state changes
     * @type {function(string, string): void|undefined}
     */
    onChange

    /**
     * Backing change subscription of a streaming data source (records are pushed instead of polled)
     * @type {BackingStream|undefined}
     * @readonly
     */
    stream
    /**
     * Keys subscribed with the stream
     * @type {Set<string>}
     * @private
     */
    subscribed = new Set()
    /**
     * Last ledger passed to `advanceLedger`
     * @type {number}
     * @private
     */
    lastLedger = 0

    /**
     * Delay of the second load after an event-driven refresh, in milliseconds (0 disables it): a data source may
     * serve ledger state that lags its event stream, so the first load can predate the change the event reports
     * @type {number}
     * @readonly
     */
    recheckDelay
    /**
     * Scheduled rechecks by key: `due` moves forward with every new event of the key
     * @type {Map<string, {due: number, timer: NodeJS.Timeout}>}
     * @private
     */
    rechecks = new Map()

    /**
     * @type {BackingLoader}
     * @private
     */
    loader
    /**
     * Tracked records by `owner|asset` key
     * @type {Map<string, TrackedBacking>}
     * @readonly
     */
    records = new Map()
    /**
     * Assets of the tracked records by owner
     * @type {Map<string, Set<string>>}
     * @private
     */
    owners = new Map()
    /**
     * In-flight refresh promises by key
     * @type {Map<string, Promise>}
     * @private
     */
    pending = new Map()
    /**
     * Keys waiting for a free loader slot
     * @type {string[]}
     * @private
     */
    queue = []
    /**
     * Currently running loader calls
     * @type {number}
     * @private
     */
    active = 0
    /**
     * @type {NodeJS.Timeout}
     * @private
     */
    timer

    /**
     * True once every scheduled refresh has completed
     * @return {boolean}
     */
    get ready() {
        return this.pending.size === 0 && this.queue.length === 0
    }

    /**
     * Get the tracked backing record
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @return {TrackedBacking|undefined}
     */
    get(owner, asset) {
        return this.records.get(toKey(owner, asset))
    }

    /**
     * Assets the owner has a backing record in (tracked for orders or watched)
     * @param {string} owner - Account address
     * @return {string[]}
     */
    assetsOf(owner) {
        const assets = this.owners.get(owner)
        return assets ? [...assets] : []
    }

    /**
     * Wait for the in-flight load or subscription snapshot of a record, without starting a new one
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @return {Promise<TrackedBacking|undefined>}
     */
    whenLoaded(owner, asset) {
        const key = toKey(owner, asset)
        return this.pending.get(key) ?? Promise.resolve(this.records.get(key))
    }

    /**
     * Effective backing of the owner in the asset: min(balance, allowance), zero when unknown, unauthorized or expired
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @param {number} [lastLedger] - Current ledger sequence for the allowance expiration check
     * @return {bigint}
     */
    getBudget(owner, asset, lastLedger = 0) {
        const record = this.get(owner, asset)
        if (!record || !record.authorized)
            return 0n
        if (lastLedger && record.liveUntil && record.liveUntil < lastLedger)
            return 0n //expired allowance
        const budget = record.balance < record.allowance ? record.balance : record.allowance
        return budget < 0n ? 0n : budget
    }

    /**
     * Backing record extended with the effective budget
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @param {number} [lastLedger] - Current ledger sequence
     * @return {BackingView|undefined}
     */
    describe(owner, asset, lastLedger = 0) {
        const record = this.get(owner, asset)
        if (!record)
            return undefined
        return {
            balance: record.balance,
            authorized: record.authorized,
            allowance: record.allowance,
            liveUntil: record.liveUntil,
            headroom: record.headroom,
            updated: record.updated,
            skipped: record.skipped,
            pending: record.pending === true,
            budget: this.getBudget(owner, asset, lastLedger)
        }
    }

    /**
     * Record that the contract skipped a fill of the maker's order selling the asset (`skip` event)
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address sold by the skipped order
     * @param {number} ts - Event timestamp, UNIX seconds
     */
    markSkipped(owner, asset, ts) {
        const record = this.get(owner, asset)
        if (record && !(record.skipped >= ts)) {
            record.skipped = ts
        }
    }

    /**
     * Set the backing record explicitly (replay from persistence, tests)
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @param {BackingRecord} record - Backing fields
     * @param {number} [updated] - Refresh timestamp, UNIX milliseconds (now by default)
     */
    set(owner, asset, record, updated = Date.now()) {
        const key = toKey(owner, asset)
        const existing = this.records.get(key)
        const pending = this.rechecks.has(key)
        const changed = !existing || !existing.updated || existing.pending !== pending ||
            existing.balance !== record.balance || existing.allowance !== record.allowance ||
            existing.liveUntil !== record.liveUntil || existing.authorized !== record.authorized ||
            existing.headroom !== record.headroom
        this.addRecord(key, {
            owner,
            asset,
            balance: record.balance,
            authorized: record.authorized,
            allowance: record.allowance,
            liveUntil: record.liveUntil,
            headroom: record.headroom,
            updated,
            skipped: existing?.skipped ?? 0,
            refs: existing?.refs ?? 0,
            pending
        })
        if (changed) {
            this.notify(owner, asset)
        }
    }

    /**
     * Whether a load confirming the latest event is still due (a recheck is scheduled): until then the record may
     * predate the change the event reported
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @return {boolean}
     */
    isPending(owner, asset) {
        return this.rechecks.has(toKey(owner, asset))
    }

    /**
     * Start tracking a maker in an asset (one reference per live order); loads the record if it is missing or stale
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     */
    track(owner, asset) {
        const key = toKey(owner, asset)
        let record = this.records.get(key)
        if (!record) {
            record = {owner, asset, balance: 0n, authorized: false, allowance: 0n, liveUntil: 0, updated: 0, skipped: 0, refs: 0, pending: false}
            this.addRecord(key, record)
        }
        record.refs++
        if (this.stream) {
            if (!this.subscribed.has(key)) {
                this.subscribe(key, owner, asset)
            }
        } else if (this.isStale(record)) {
            this.refresh(owner, asset)
        }
    }

    /**
     * Release one reference; the record is dropped when nothing references it anymore
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     */
    untrack(owner, asset) {
        const key = toKey(owner, asset)
        const record = this.records.get(key)
        if (!record)
            return
        record.refs--
        if (record.refs <= 0) {
            this.dropRecord(key, record)
            if (this.subscribed.delete(key)) {
                this.stream.unsubscribe(asset, owner)
            }
        }
    }

    /**
     * Apply a backing change pushed by a streaming data source (ignored for pairs that are not tracked)
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @param {BackingRecord} record - Current backing
     */
    apply(owner, asset, record) {
        if (this.records.has(toKey(owner, asset))) {
            this.set(owner, asset, record)
        }
    }

    /**
     * Account for a new ledger: records whose allowance has just expired change their budget without any ledger
     * entry change, so they are reported
     * @param {number} ledger - Ledger sequence
     */
    advanceLedger(ledger) {
        const previous = this.lastLedger
        if (ledger <= previous)
            return
        this.lastLedger = ledger
        if (!previous)
            return //first ledger: nothing crossed yet
        for (const record of this.records.values()) {
            //expired once `liveUntil < lastLedger` (see `getBudget`)
            if (record.liveUntil && record.liveUntil >= previous && record.liveUntil < ledger && record.allowance > 0n) {
                this.notify(record.owner, record.asset)
            }
        }
    }

    /**
     * Subscribe a tracked pair with the stream; the snapshot it resolves with becomes the record
     * @param {string} key
     * @param {string} owner
     * @param {string} asset
     * @private
     */
    subscribe(key, owner, asset) {
        this.subscribed.add(key)
        const promise = this.stream.subscribe(asset, owner)
            .then(loaded => {
                if (loaded && this.records.has(key)) {
                    this.set(owner, asset, loaded)
                }
            }, e => console.error(`Failed to subscribe to backing of ${owner} in ${asset}`, e))
            .then(() => {
                if (this.pending.get(key) === promise) {
                    this.pending.delete(key)
                }
                return this.records.get(key)
            })
        //counted as an in-flight load until the snapshot arrives (`ready`), `refresh` joins it
        this.pending.set(key, promise)
    }

    /**
     * Reload the backing record (deduplicates in-flight requests)
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @return {Promise<TrackedBacking|undefined>}
     */
    refresh(owner, asset) {
        if (!this.loader)
            return Promise.resolve(this.get(owner, asset))
        const key = toKey(owner, asset)
        let promise = this.pending.get(key)
        if (promise)
            return promise
        const tracked = this.records.has(key)
        promise = new Promise((resolve, reject) => {
            this.queue.push({key, owner, asset, tracked, resolve, reject})
        })
        this.pending.set(key, promise)
        this.drain()
        return promise
    }

    /**
     * Reload a record after a contract event changed it (trade, order created or updated with an approval, skip), and
     * once more `recheckDelay` after the latest such event, in case the first load read state older than the event
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @return {Promise<TrackedBacking|undefined>} - First load
     */
    refreshAfterEvent(owner, asset) {
        if (this.stream)
            return Promise.resolve(this.get(owner, asset)) //the change arrives with the stream
        const res = this.refresh(owner, asset)
        if (this.recheckDelay > 0 && this.loader) {
            const key = toKey(owner, asset)
            const due = Date.now() + this.recheckDelay
            const recheck = this.rechecks.get(key)
            if (recheck) {
                recheck.due = due
            } else {
                this.rechecks.set(key, {due, timer: undefined})
                this.scheduleRecheck(key, owner, asset)
                this.syncPending(key)
            }
        }
        return res
    }

    /**
     * Reload a record after the contract skipped a fill of the maker: the tracked state did not predict the failure,
     * so it is reloaded even when streamed
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @return {Promise<TrackedBacking|undefined>} - First load
     */
    refreshAfterSkip(owner, asset) {
        return this.stream ? this.refresh(owner, asset) : this.refreshAfterEvent(owner, asset)
    }

    /**
     * @param {string} key
     * @param {string} owner
     * @param {string} asset
     * @private
     */
    scheduleRecheck(key, owner, asset) {
        const recheck = this.rechecks.get(key)
        recheck.timer = setTimeout(() => {
            if (Date.now() < recheck.due)
                return this.scheduleRecheck(key, owner, asset) //postponed by a later event
            this.rechecks.delete(key)
            if (this.records.has(key)) {
                //the load settles the pending state (a failed one leaves the record as is, see `load`)
                this.refresh(owner, asset)
            }
        }, Math.max(0, recheck.due - Date.now()))
        recheck.timer.unref?.()
    }

    /**
     * Refresh every record that has not been updated for longer than `staleAfter`
     */
    sweep() {
        const now = Date.now()
        for (const record of this.records.values()) {
            if (now - record.updated > this.staleAfter) {
                this.refresh(record.owner, record.asset)
            }
        }
    }

    /**
     * Start periodic refresh of stale records
     */
    start() {
        if (this.timer || this.stream)
            return
        this.timer = setInterval(() => this.sweep(), this.refreshInterval)
        this.timer.unref?.()
    }

    /**
     * Stop periodic refresh
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = undefined
        }
        for (const {timer} of this.rechecks.values()) {
            clearTimeout(timer)
        }
        this.rechecks.clear()
    }

    /**
     * @param {TrackedBacking} record
     * @return {boolean}
     * @private
     */
    isStale(record) {
        return Date.now() - record.updated > this.staleAfter
    }

    /**
     * Run queued loader calls up to the concurrency limit
     * @private
     */
    drain() {
        while (this.active < this.concurrency && this.queue.length > 0) {
            const task = this.queue.shift()
            this.active++
            this.load(task)
                .finally(() => {
                    this.active--
                    this.drain()
                })
        }
    }

    /**
     * @param {{key: string, owner: string, asset: string, tracked: boolean, resolve: function, reject: function}} task
     * @return {Promise<void>}
     * @private
     */
    async load(task) {
        const {key, owner, asset, tracked} = task
        //settled before the caller resumes, so a refresh requested right after it starts a new load
        const settle = () => this.pending.delete(key)
        try {
            const loaded = await this.loader(asset, owner)
            //a tracked record may have been dropped while loading - keep it only if still referenced
            if (loaded && (this.records.has(key) || !tracked)) {
                this.set(owner, asset, loaded)
            }
            settle()
            task.resolve(this.records.get(key))
        } catch (e) {
            console.error(`Failed to load backing of ${owner} in ${asset}`, e)
            this.syncPending(key) //the data is not confirmed, but no newer load is due until the next sweep
            settle()
            task.resolve(this.records.get(key)) //retried on the next sweep
        }
    }

    /**
     * @param {string} key
     * @param {TrackedBacking} record
     * @private
     */
    addRecord(key, record) {
        this.records.set(key, record)
        let assets = this.owners.get(record.owner)
        if (!assets) {
            assets = new Set()
            this.owners.set(record.owner, assets)
        }
        assets.add(record.asset)
    }

    /**
     * @param {string} key
     * @param {TrackedBacking} record
     * @private
     */
    dropRecord(key, record) {
        this.records.delete(key)
        const assets = this.owners.get(record.owner)
        if (assets) {
            assets.delete(record.asset)
            if (!assets.size) {
                this.owners.delete(record.owner)
            }
        }
    }

    /**
     * Align the record's `pending` flag with the scheduled rechecks, notifying about a flip
     * @param {string} key
     * @private
     */
    syncPending(key) {
        const record = this.records.get(key)
        if (!record)
            return
        const pending = this.rechecks.has(key)
        if (record.pending !== pending) {
            record.pending = pending
            this.notify(record.owner, record.asset)
        }
    }

    /**
     * @param {string} owner
     * @param {string} asset
     * @private
     */
    notify(owner, asset) {
        if (!this.onChange)
            return
        try {
            this.onChange(owner, asset)
        } catch (e) {
            console.error('Backing change handler failed', e)
        }
    }
}

/**
 * @param {string} owner
 * @param {string} asset
 * @return {string}
 */
function toKey(owner, asset) {
    return owner + '|' + asset
}

module.exports = BackingTracker

/**
 * @callback BackingLoader
 * @param {string} asset - Token contract address
 * @param {string} owner - Account address
 * @return {Promise<BackingRecord>}
 */

/**
 * @typedef {Object} BackingTrackerOptions
 * @property {number} [refreshInterval=60000] - Period of the stale records sweep, in milliseconds
 * @property {number} [staleAfter=300000] - Record age after which it is refreshed, in milliseconds
 * @property {number} [concurrency=4] - Maximum concurrent loader calls
 * @property {number} [recheckDelay=30000] - Delay of the second load after an event-driven refresh, in milliseconds
 *   (0 disables it): covers data sources whose ledger state lags their event stream
 * @property {function(string, string): void} [onChange] - Called with `(owner, asset)` when a record changes
 * @property {BackingStream} [stream] - Subscribe to pushed backing changes instead of polling (sweeps and rechecks
 *   are disabled, `refreshInterval`, `staleAfter` and `recheckDelay` do not apply)
 */

/**
 * Backing change subscription of a streaming data source
 * @typedef {Object} BackingStream
 * @property {function(string, string): Promise<BackingRecord>} subscribe - `(asset, owner)`: start streaming the
 *   pair, resolves with its current backing
 * @property {function(string, string): void} unsubscribe - `(asset, owner)`: stop streaming the pair
 */

/**
 * @typedef {BackingRecord} TrackedBacking
 * @property {string} owner - Account address
 * @property {string} asset - Token contract address
 * @property {number} updated - Last refresh timestamp, UNIX milliseconds (0 = never loaded)
 * @property {number} skipped - Timestamp of the last `skip` event of an order selling the asset, UNIX seconds (0 = none)
 * @property {number} refs - Number of live orders referencing the record
 * @property {boolean} pending - A recheck confirming the latest event is still due
 */
