const BackingTracker = require('../../src/graph/backing-tracker')

const OWNER = 'GOWNER'
const ASSET = 'CASSET'

function record(overrides = {}) {
    return {balance: 1000n, authorized: true, allowance: 500n, liveUntil: 1000, ...overrides}
}

/** Loader recording its calls and resolving with a queued or default record */
function makeLoader(defaults = record()) {
    const calls = []
    const responses = new Map()
    const loader = jest.fn(async (asset, owner) => {
        calls.push([asset, owner])
        const queued = responses.get(owner + '|' + asset)
        if (queued instanceof Error)
            throw queued
        return queued ?? defaults
    })
    loader.calls = calls
    loader.respond = (owner, asset, value) => responses.set(owner + '|' + asset, value)
    return loader
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve))
}

describe('BackingTracker budgets', () => {
    test('unknown pair has zero budget and no record', () => {
        const tracker = new BackingTracker()
        expect(tracker.get(OWNER, ASSET)).toBeUndefined()
        expect(tracker.getBudget(OWNER, ASSET)).toBe(0n)
        expect(tracker.describe(OWNER, ASSET)).toBeUndefined()
    })

    test('budget is min(balance, allowance)', () => {
        const tracker = new BackingTracker()
        tracker.set(OWNER, ASSET, record({balance: 1000n, allowance: 500n}))
        expect(tracker.getBudget(OWNER, ASSET, 10)).toBe(500n)
        tracker.set(OWNER, ASSET, record({balance: 100n, allowance: 500n}))
        expect(tracker.getBudget(OWNER, ASSET, 10)).toBe(100n)
    })

    test('expired allowance and deauthorized trustline yield zero', () => {
        const tracker = new BackingTracker()
        tracker.set(OWNER, ASSET, record({liveUntil: 100}))
        expect(tracker.getBudget(OWNER, ASSET, 100)).toBe(500n)
        expect(tracker.getBudget(OWNER, ASSET, 101)).toBe(0n)
        tracker.set(OWNER, ASSET, record({authorized: false}))
        expect(tracker.getBudget(OWNER, ASSET, 10)).toBe(0n)
    })

    test('describe includes the budget and refresh timestamp', () => {
        const tracker = new BackingTracker()
        tracker.set(OWNER, ASSET, record(), 12345)
        expect(tracker.describe(OWNER, ASSET, 10)).toEqual({
            balance: 1000n, authorized: true, allowance: 500n, liveUntil: 1000, updated: 12345, skipped: 0, pending: false, budget: 500n
        })
    })
})

describe('BackingTracker tracking', () => {
    test('track loads the record once and untrack drops it when unreferenced', async () => {
        const loader = makeLoader()
        const tracker = new BackingTracker(loader)
        tracker.track(OWNER, ASSET)
        tracker.track(OWNER, ASSET)
        expect(tracker.ready).toBe(false)
        await flush()
        expect(loader).toHaveBeenCalledTimes(1)
        expect(loader.calls[0]).toEqual([ASSET, OWNER])
        expect(tracker.ready).toBe(true)
        expect(tracker.get(OWNER, ASSET)).toMatchObject({balance: 1000n, allowance: 500n, refs: 2})
        tracker.untrack(OWNER, ASSET)
        expect(tracker.get(OWNER, ASSET)).toBeDefined()
        tracker.untrack(OWNER, ASSET)
        expect(tracker.get(OWNER, ASSET)).toBeUndefined()
    })

    test('a fresh record is not reloaded on track', async () => {
        const loader = makeLoader()
        const tracker = new BackingTracker(loader)
        tracker.set(OWNER, ASSET, record())
        tracker.track(OWNER, ASSET)
        await flush()
        expect(loader).not.toHaveBeenCalled()
    })

    test('refresh deduplicates in-flight requests and honors the concurrency limit', async () => {
        let pending = 0
        let maxPending = 0
        const releases = []
        const loader = jest.fn(() => new Promise(resolve => {
            pending++
            maxPending = Math.max(maxPending, pending)
            releases.push(() => {
                pending--
                resolve(record())
            })
        }))
        const tracker = new BackingTracker(loader, {concurrency: 2})
        const first = tracker.refresh(OWNER, 'A')
        const again = tracker.refresh(OWNER, 'A')
        tracker.refresh(OWNER, 'B')
        tracker.refresh(OWNER, 'C')
        expect(again).toBe(first)
        await flush()
        expect(loader).toHaveBeenCalledTimes(2)
        expect(maxPending).toBe(2)
        releases.shift()()
        await flush()
        expect(loader).toHaveBeenCalledTimes(3)
        while (releases.length) {
            releases.shift()()
            await flush()
        }
        expect(tracker.ready).toBe(true)
        expect(tracker.get(OWNER, 'C')).toMatchObject({balance: 1000n})
    })

    test('loader failures are logged and leave the record stale for the next sweep', async () => {
        const loader = makeLoader()
        loader.respond(OWNER, ASSET, new Error('boom'))
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        const tracker = new BackingTracker(loader)
        tracker.track(OWNER, ASSET)
        await flush()
        expect(errSpy).toHaveBeenCalled()
        expect(tracker.get(OWNER, ASSET)).toMatchObject({balance: 0n, updated: 0})
        expect(tracker.getBudget(OWNER, ASSET)).toBe(0n)
        errSpy.mockRestore()
    })

    test('sweep refreshes only stale records', async () => {
        const loader = makeLoader()
        const tracker = new BackingTracker(loader, {staleAfter: 1000})
        tracker.set(OWNER, 'FRESH', record(), Date.now())
        tracker.set(OWNER, 'STALE', record(), Date.now() - 5000)
        tracker.sweep()
        await flush()
        expect(loader.calls).toEqual([['STALE', OWNER]])
    })

    test('start schedules periodic sweeps and stop cancels them', async () => {
        jest.useFakeTimers()
        try {
            const loader = makeLoader()
            const tracker = new BackingTracker(loader, {refreshInterval: 1000, staleAfter: 500})
            tracker.set(OWNER, ASSET, record(), Date.now())
            tracker.start()
            jest.advanceTimersByTime(1000)
            expect(loader).toHaveBeenCalledTimes(1)
            tracker.stop()
            jest.advanceTimersByTime(5000)
            expect(loader).toHaveBeenCalledTimes(1)
        } finally {
            jest.useRealTimers()
        }
    })
})

describe('BackingTracker event rechecks', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    test('reloads once more after the delay, catching state the first load missed', async () => {
        const loader = makeLoader()
        const tracker = new BackingTracker(loader, {recheckDelay: 30_000})
        tracker.track(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(0)
        //the data source still serves the old allowance right after the event
        tracker.refreshAfterEvent(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(0)
        expect(loader.calls.length).toBe(2)
        expect(tracker.get(OWNER, ASSET).allowance).toBe(500n)
        //by the recheck it has caught up
        loader.respond(OWNER, ASSET, record({allowance: 900n}))
        await jest.advanceTimersByTimeAsync(30_000)
        expect(loader.calls.length).toBe(3)
        expect(tracker.get(OWNER, ASSET).allowance).toBe(900n)
        tracker.stop()
    })

    test('a later event postpones the recheck instead of adding one', async () => {
        const loader = makeLoader()
        const tracker = new BackingTracker(loader, {recheckDelay: 30_000})
        tracker.track(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(0)
        tracker.refreshAfterEvent(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(20_000)
        tracker.refreshAfterEvent(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(0)
        const before = loader.calls.length
        await jest.advanceTimersByTimeAsync(10_000) //first due time: postponed
        expect(loader.calls.length).toBe(before)
        await jest.advanceTimersByTimeAsync(20_000)
        expect(loader.calls.length).toBe(before + 1)
        tracker.stop()
    })

    test('stop cancels pending rechecks', async () => {
        const loader = makeLoader()
        const tracker = new BackingTracker(loader, {recheckDelay: 30_000})
        tracker.track(OWNER, ASSET)
        tracker.track(OWNER, 'COTHER')
        await jest.advanceTimersByTimeAsync(0)
        tracker.refreshAfterEvent(OWNER, ASSET)
        tracker.refreshAfterEvent(OWNER, 'COTHER')
        await jest.advanceTimersByTimeAsync(0)
        tracker.untrack(OWNER, ASSET)
        const before = loader.calls.length
        tracker.stop()
        await jest.advanceTimersByTimeAsync(60_000)
        expect(loader.calls.length).toBe(before)
    })

    test('recheckDelay 0 disables rechecks', async () => {
        const loader = makeLoader()
        const tracker = new BackingTracker(loader, {recheckDelay: 0})
        tracker.track(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(0)
        tracker.refreshAfterEvent(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(60_000)
        expect(loader.calls.length).toBe(2)
    })
})

describe('BackingTracker owner index', () => {
    test('assetsOf lists the tracked assets of an owner until their last reference is released', () => {
        const tracker = new BackingTracker()
        expect(tracker.assetsOf(OWNER)).toEqual([])
        tracker.track(OWNER, 'CA')
        tracker.track(OWNER, 'CB')
        tracker.track(OWNER, 'CB')
        tracker.track('GOTHER', 'CA')
        expect(tracker.assetsOf(OWNER).sort()).toEqual(['CA', 'CB'])
        tracker.untrack(OWNER, 'CB')
        expect(tracker.assetsOf(OWNER).sort()).toEqual(['CA', 'CB'])
        tracker.untrack(OWNER, 'CB')
        tracker.untrack(OWNER, 'CA')
        expect(tracker.assetsOf(OWNER)).toEqual([])
        expect(tracker.owners.has(OWNER)).toBe(false)
        expect(tracker.assetsOf('GOTHER')).toEqual(['CA'])
    })

    test('records set explicitly are indexed', () => {
        const tracker = new BackingTracker()
        tracker.set(OWNER, ASSET, record())
        expect(tracker.assetsOf(OWNER)).toEqual([ASSET])
    })
})

describe('BackingTracker change notifications', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    test('onChange fires for the first load and for changed values only', async () => {
        const loader = makeLoader()
        const onChange = jest.fn()
        const tracker = new BackingTracker(loader, {recheckDelay: 0, onChange})
        tracker.track(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(0)
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith(OWNER, ASSET)
        await tracker.refresh(OWNER, ASSET) //same values
        expect(onChange).toHaveBeenCalledTimes(1)
        loader.respond(OWNER, ASSET, record({allowance: 50n}))
        await tracker.refresh(OWNER, ASSET)
        expect(onChange).toHaveBeenCalledTimes(2)
        tracker.stop()
    })

    test('a record is pending between an event and its recheck', async () => {
        const loader = makeLoader()
        const onChange = jest.fn()
        const tracker = new BackingTracker(loader, {recheckDelay: 30_000, onChange})
        tracker.track(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(0)
        onChange.mockClear()
        tracker.refreshAfterEvent(OWNER, ASSET)
        expect(tracker.isPending(OWNER, ASSET)).toBe(true)
        expect(tracker.describe(OWNER, ASSET).pending).toBe(true)
        expect(onChange).toHaveBeenCalledTimes(1) //flipped to pending right away
        await jest.advanceTimersByTimeAsync(0)
        expect(onChange).toHaveBeenCalledTimes(1) //first load, same values, still pending
        await jest.advanceTimersByTimeAsync(30_000)
        expect(tracker.isPending(OWNER, ASSET)).toBe(false)
        expect(tracker.describe(OWNER, ASSET).pending).toBe(false)
        expect(onChange).toHaveBeenCalledTimes(2) //confirmed by the recheck
        tracker.stop()
    })

    test('a failed recheck still clears the pending state', async () => {
        const loader = makeLoader()
        const tracker = new BackingTracker(loader, {recheckDelay: 30_000})
        const error = jest.spyOn(console, 'error').mockImplementation(() => {})
        tracker.track(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(0)
        tracker.refreshAfterEvent(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(0)
        loader.respond(OWNER, ASSET, new Error('boom'))
        await jest.advanceTimersByTimeAsync(30_000)
        expect(tracker.describe(OWNER, ASSET).pending).toBe(false)
        error.mockRestore()
        tracker.stop()
    })
})

describe('BackingTracker stream mode', () => {
    beforeEach(() => jest.useFakeTimers({doNotFake: ['setImmediate']}))
    afterEach(() => jest.useRealTimers())

    /** Stream recording subscriptions and resolving with a queued or default snapshot */
    function makeStream(snapshot = record()) {
        const stream = {
            subscribed: [],
            unsubscribed: [],
            subscribe: jest.fn(async (asset, owner) => {
                stream.subscribed.push([asset, owner])
                return snapshot
            }),
            unsubscribe: jest.fn((asset, owner) => stream.unsubscribed.push([asset, owner]))
        }
        return stream
    }

    test('subscribes on the first reference and unsubscribes with the last one', async () => {
        const stream = makeStream()
        const loader = makeLoader()
        const tracker = new BackingTracker(loader, {stream})
        tracker.track(OWNER, ASSET)
        tracker.track(OWNER, ASSET)
        expect(tracker.ready).toBe(false)
        await flush()
        expect(tracker.ready).toBe(true)
        expect(stream.subscribed).toEqual([[ASSET, OWNER]])
        expect(loader).not.toHaveBeenCalled()
        expect(tracker.get(OWNER, ASSET)).toMatchObject({balance: 1000n, allowance: 500n, refs: 2})
        tracker.untrack(OWNER, ASSET)
        expect(stream.unsubscribed).toEqual([])
        tracker.untrack(OWNER, ASSET)
        expect(stream.unsubscribed).toEqual([[ASSET, OWNER]])
        //tracked again: a new subscription
        tracker.track(OWNER, ASSET)
        expect(stream.subscribed).toHaveLength(2)
    })

    test('pushed changes update tracked records and notify only on change', async () => {
        const onChange = jest.fn()
        const tracker = new BackingTracker(makeLoader(), {stream: makeStream(), onChange})
        tracker.track(OWNER, ASSET)
        await flush()
        expect(onChange).toHaveBeenCalledTimes(1) //the snapshot
        tracker.apply(OWNER, ASSET, record({balance: 300n}))
        expect(tracker.getBudget(OWNER, ASSET)).toBe(300n)
        expect(onChange).toHaveBeenCalledTimes(2)
        tracker.apply(OWNER, ASSET, record({balance: 300n}))
        expect(onChange).toHaveBeenCalledTimes(2)
        //untracked pairs are ignored
        tracker.apply(OWNER, 'COTHER', record())
        expect(tracker.get(OWNER, 'COTHER')).toBeUndefined()
    })

    test('no polling: no sweeps, no event-driven reloads, no pending state', async () => {
        const loader = makeLoader()
        const tracker = new BackingTracker(loader, {stream: makeStream(), staleAfter: 0, refreshInterval: 1000})
        tracker.start()
        tracker.track(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(10_000)
        tracker.refreshAfterEvent(OWNER, ASSET)
        await jest.advanceTimersByTimeAsync(60_000)
        expect(loader).not.toHaveBeenCalled()
        expect(tracker.describe(OWNER, ASSET).pending).toBe(false)
        tracker.stop()
    })

    test('a skip reloads the record once', async () => {
        const loader = makeLoader(record({balance: 10n}))
        const tracker = new BackingTracker(loader, {stream: makeStream()})
        tracker.track(OWNER, ASSET)
        await flush()
        tracker.refreshAfterSkip(OWNER, ASSET)
        await flush()
        expect(loader).toHaveBeenCalledTimes(1)
        expect(tracker.get(OWNER, ASSET).balance).toBe(10n)
        await jest.advanceTimersByTimeAsync(60_000)
        expect(loader).toHaveBeenCalledTimes(1)
    })

    test('whenLoaded waits for the subscription snapshot without loading again', async () => {
        const loader = makeLoader()
        const stream = makeStream(record({balance: 42n}))
        const tracker = new BackingTracker(loader, {stream})
        tracker.track(OWNER, ASSET)
        const loaded = await tracker.whenLoaded(OWNER, ASSET)
        expect(loaded.balance).toBe(42n)
        expect(loaded.updated).toBeGreaterThan(0)
        //loaded already: resolves with the record, no new read
        expect((await tracker.whenLoaded(OWNER, ASSET)).balance).toBe(42n)
        expect(loader).not.toHaveBeenCalled()
        expect(stream.subscribe).toHaveBeenCalledTimes(1)
        expect(await tracker.whenLoaded(OWNER, 'CUNKNOWN')).toBeUndefined()
    })

    test('advanceLedger reports allowances that just expired', async () => {
        const onChange = jest.fn()
        const tracker = new BackingTracker(makeLoader(), {stream: makeStream(record({liveUntil: 105})), onChange})
        tracker.track(OWNER, ASSET)
        await flush()
        onChange.mockClear()
        tracker.advanceLedger(100)
        tracker.advanceLedger(105)
        expect(onChange).not.toHaveBeenCalled()
        expect(tracker.getBudget(OWNER, ASSET, 105)).toBe(500n)
        tracker.advanceLedger(106)
        expect(onChange).toHaveBeenCalledWith(OWNER, ASSET)
        expect(tracker.getBudget(OWNER, ASSET, 106)).toBe(0n)
        onChange.mockClear()
        tracker.advanceLedger(107)
        expect(onChange).not.toHaveBeenCalled()
    })
})
