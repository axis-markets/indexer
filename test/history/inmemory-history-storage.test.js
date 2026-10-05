const InMemoryHistoryStorage = require('../../src/history/inmemory-history-storage')
const Order = require('../../src/entries/order')
const Trade = require('../../src/entries/trade')
const Swap = require('../../src/entries/swap')
const Failure = require('../../src/entries/failure')
const {makeOrder} = require('../helpers/order-factory')

/**
 * @param {Partial<Trade>} overrides
 * @return {Trade}
 */
function makeTrade(overrides = {}) {
    const trade = new Trade()
    trade.id = overrides.id ?? 1n
    trade.order = overrides.order ?? 10n
    trade.taker = overrides.taker ?? 'TAKER'
    trade.maker = overrides.maker ?? 'MAKER'
    trade.soldAsset = overrides.soldAsset ?? 'S'
    trade.boughtAsset = overrides.boughtAsset ?? 'B'
    trade.sold = overrides.sold ?? 100n
    trade.bought = overrides.bought ?? 200n
    trade.left = overrides.left ?? 0n
    trade.cursor = overrides.cursor ?? String(trade.id)
    trade.ts = overrides.ts ?? 1_700_000_000_000
    return trade
}

/**
 * @param {Partial<Swap>} overrides
 * @return {Swap}
 */
function makeSwap(overrides = {}) {
    const swap = new Swap()
    swap.id = overrides.id ?? 1n
    swap.trader = overrides.trader ?? 'TRADER'
    swap.soldAsset = overrides.soldAsset ?? 'S'
    swap.boughtAsset = overrides.boughtAsset ?? 'B'
    swap.sold = overrides.sold ?? 100n
    swap.bought = overrides.bought ?? 200n
    swap.cursor = overrides.cursor ?? String(swap.id)
    swap.ts = overrides.ts ?? 1_700_000_000_000
    return swap
}

describe('InMemoryHistoryStorage', () => {
    test('cursor is persisted by storeTrade and storeOrder and read back via getCursor', async () => {
        const storage = new InMemoryHistoryStorage()
        expect(await storage.getCursor()).toBeUndefined()
        await storage.storeTrade(makeTrade({id: 1n}), 'cursor-1')
        expect(await storage.getCursor()).toBe('cursor-1')
        await storage.storeOrder(makeOrder({id: 1n, status: Order.ORDER_STATUS.FILLED}), 'cursor-2')
        expect(await storage.getCursor()).toBe('cursor-2')
        //the progress past a ledger without events
        await storage.storeCursor('cursor-3')
        expect(await storage.getCursor()).toBe('cursor-3')
    })

    test('storeTrade appends to the in-memory log', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n}))
        await storage.storeTrade(makeTrade({id: 2n}))
        const trades = await storage.loadTrades({limit: 10})
        expect(trades.map(t => t.id)).toEqual([2n, 1n])
    })

    test('storeOrder keeps an ACTIVE order in the active set, not the archive', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, status: Order.ORDER_STATUS.ACTIVE}))
        await storage.storeOrder(makeOrder({id: 2n, status: Order.ORDER_STATUS.ACTIVE}))
        const active = await storage.loadActiveOrders({limit: 10})
        expect(active.map(o => o.id)).toEqual([2n, 1n])
        const archived = await storage.loadArchivedOrders({limit: 10})
        expect(archived).toEqual([])
    })

    test('storeOrder moves an order from the active set to the archive when finalized', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, status: Order.ORDER_STATUS.ACTIVE}))
        //same order finalizes — must leave the active set and land in the archive
        await storage.storeOrder(makeOrder({id: 1n, status: Order.ORDER_STATUS.FILLED}))
        expect((await storage.loadActiveOrders({limit: 10})).map(o => o.id)).toEqual([])
        expect((await storage.loadArchivedOrders({limit: 10})).map(o => o.id)).toEqual([1n])
    })

    test('loadActiveOrders filters by owner, pair and cursor', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, owner: 'X', selling: 'S', buying: 'B', status: Order.ORDER_STATUS.ACTIVE}))
        await storage.storeOrder(makeOrder({id: 2n, owner: 'Y', selling: 'S', buying: 'B', status: Order.ORDER_STATUS.ACTIVE}))
        await storage.storeOrder(makeOrder({id: 3n, owner: 'X', selling: 'X', buying: 'Y', status: Order.ORDER_STATUS.ACTIVE}))
        expect((await storage.loadActiveOrders({limit: 10, owner: 'X'})).map(o => o.id)).toEqual([3n, 1n])
        expect((await storage.loadActiveOrders({limit: 10, pair: 'B/S'})).map(o => o.id)).toEqual([2n, 1n])
        expect((await storage.loadActiveOrders({limit: 10, cursor: 2n})).map(o => o.id)).toEqual([1n])
    })

    test('storeOrder accepts a finalized order', async () => {
        const storage = new InMemoryHistoryStorage()
        const filled = makeOrder({id: 1n, status: Order.ORDER_STATUS.FILLED})
        const cancelled = makeOrder({id: 2n, status: Order.ORDER_STATUS.CANCELED})
        await storage.storeOrder(filled)
        await storage.storeOrder(cancelled)
        const orders = await storage.loadArchivedOrders({limit: 10})
        expect(orders.map(o => o.id)).toEqual([2n, 1n])
    })

    test('loadTrades respects limit and returns newest first', async () => {
        const storage = new InMemoryHistoryStorage()
        for (let i = 1; i <= 5; i++) {
            await storage.storeTrade(makeTrade({id: BigInt(i)}))
        }
        const trades = await storage.loadTrades({limit: 2})
        expect(trades.map(t => t.id)).toEqual([5n, 4n])
    })

    test('loadTrades filters by trader (matches maker or taker)', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n, maker: 'A', taker: 'B'}))
        await storage.storeTrade(makeTrade({id: 2n, maker: 'C', taker: 'A'}))
        await storage.storeTrade(makeTrade({id: 3n, maker: 'D', taker: 'E'}))
        const trades = await storage.loadTrades({limit: 10, trader: 'A'})
        expect(trades.map(t => t.id)).toEqual([2n, 1n])
    })

    test('loadTrades skips trades at or after the cursor (exclusive)', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n}))
        await storage.storeTrade(makeTrade({id: 2n}))
        await storage.storeTrade(makeTrade({id: 3n}))
        const trades = await storage.loadTrades({limit: 10, cursor: 2n})
        expect(trades.map(t => t.id)).toEqual([1n])
    })

    test('loadArchivedOrders filters by owner', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, owner: 'X', status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 2n, owner: 'Y', status: Order.ORDER_STATUS.CANCELED}))
        await storage.storeOrder(makeOrder({id: 3n, owner: 'X', status: Order.ORDER_STATUS.FILLED}))
        const orders = await storage.loadArchivedOrders({limit: 10, owner: 'X'})
        expect(orders.map(o => o.id)).toEqual([3n, 1n])
    })

    test('loadArchivedOrders honors the exclusive position cursor', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 2n, status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 3n, status: Order.ORDER_STATUS.FILLED}))
        const orders = await storage.loadArchivedOrders({limit: 10, cursor: 2n})
        expect(orders.map(o => o.id)).toEqual([1n])
    })

    test('loadArchivedOrders filters by pair (matched against the canonical toPair(selling, buying))', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, selling: 'S', buying: 'B', status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 2n, selling: 'X', buying: 'Y', status: Order.ORDER_STATUS.FILLED}))
        const orders = await storage.loadArchivedOrders({limit: 10, pair: 'B/S'})
        expect(orders.map(o => o.id)).toEqual([1n])
    })

    test('loadTrades filters by pair (matched against toPair(soldAsset, boughtAsset))', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n, soldAsset: 'S', boughtAsset: 'B'}))
        await storage.storeTrade(makeTrade({id: 2n, soldAsset: 'X', boughtAsset: 'Y'}))
        const trades = await storage.loadTrades({limit: 10, pair: 'B/S'})
        expect(trades.map(t => t.id)).toEqual([1n])
    })

    test('storeTrade accepts swaps; loadTrades reconstructs them as Swap with type=swap', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeSwap({id: 1n}), 'cursor-1')
        const [entry] = await storage.loadTrades({limit: 10})
        expect(entry).toBeInstanceOf(Swap)
        expect(entry.toJSON().type).toBe('swap')
        expect(entry.id).toBe(1n)
    })

    test('loadTrades trader filter matches a swap trader as well as trade maker/taker', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n, maker: 'A', taker: 'B'}))
        await storage.storeTrade(makeSwap({id: 2n, trader: 'A'}))
        await storage.storeTrade(makeSwap({id: 3n, trader: 'Z'}))
        const entries = await storage.loadTrades({limit: 10, trader: 'A'})
        expect(entries.map(e => e.id)).toEqual([2n, 1n])
    })

    test('the archive may hold several records with the same reused id, told apart by position', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, position: 10n, status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 1n, position: 20n, status: Order.ORDER_STATUS.CANCELED}))
        const orders = await storage.loadArchivedOrders({limit: 10})
        expect(orders.map(o => [o.id, o.position])).toEqual([[1n, 20n], [1n, 10n]])
        expect((await storage.loadArchivedOrders({limit: 10, cursor: 20n})).map(o => o.position)).toEqual([10n])
    })

    test('archiving an order does not evict a newer active order that reuses the id', async () => {
        const storage = new InMemoryHistoryStorage()
        const stale = makeOrder({id: 1n, position: 10n})
        const fresh = makeOrder({id: 1n, position: 20n})
        await storage.storeOrder(fresh)
        stale.status = Order.ORDER_STATUS.FILLED
        await storage.storeOrder(stale)
        expect((await storage.loadActiveOrders({limit: 10})).map(o => o.position)).toEqual([20n])
    })

    test('trades and swaps share one log, newest first, each reconstructed to its own type', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n}))
        await storage.storeTrade(makeSwap({id: 2n}))
        await storage.storeTrade(makeTrade({id: 3n}))
        const entries = await storage.loadTrades({limit: 10})
        expect(entries.map(e => [e.id, e.toJSON().type])).toEqual([[3n, 'trade'], [2n, 'swap'], [1n, 'trade']])
        expect(entries[1]).toBeInstanceOf(Swap)
        expect(entries[0]).toBeInstanceOf(Trade)
    })
})

/**
 * Page through a newest-first query with the exclusive cursor of the last received record
 * @param {function({}): Promise<{}[]>} load
 * @param {{}} filter
 * @param {number} limit
 * @param {function({}): bigint} cursorOf
 * @return {Promise<{}[]>}
 */
async function pageAll(load, filter, limit, cursorOf) {
    const res = []
    let cursor
    //a broken storage may never reach the end
    for (let i = 0; i < 50; i++) {
        const page = await load({...filter, limit, cursor})
        res.push(...page)
        if (page.length < limit)
            return res
        cursor = cursorOf(page[page.length - 1])
    }
    throw new Error('Paging did not terminate')
}

const pageOrders = (storage, method, filter, limit) => pageAll(f => storage[method](f), filter, limit, o => o.position)
const pageTrades = (storage, filter, limit) => pageAll(f => storage.loadTrades(f), filter, limit, t => t.id)

describe('InMemoryHistoryStorage paging', () => {
    const {FILLED, CANCELED, EXPIRED, ACTIVE} = Order.ORDER_STATUS
    //beyond the int64 range and of different decimal lengths, so neither Number nor string comparison orders them
    const big = 2n ** 64n

    test('archived orders are served by position whatever the archival order', async () => {
        const storage = new InMemoryHistoryStorage()
        for (const position of [30n, 10n, 50n, 20n, 40n]) {
            await storage.storeOrder(makeOrder({id: position + 100n, position, status: FILLED}))
        }
        expect((await storage.loadArchivedOrders({limit: 10})).map(o => o.position)).toEqual([50n, 40n, 30n, 20n, 10n])
        for (const limit of [1, 2, 3, 5]) {
            const all = await pageOrders(storage, 'loadArchivedOrders', {}, limit)
            expect(all.map(o => o.position)).toEqual([50n, 40n, 30n, 20n, 10n])
        }
    })

    test('re-archiving a record keeps its position slot', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, position: 10n, status: EXPIRED}))
        await storage.storeOrder(makeOrder({id: 2n, position: 20n, status: FILLED}))
        await storage.storeOrder(makeOrder({id: 3n, position: 30n, status: FILLED}))
        //the expired order is removed by its owner: same (id, position), archived again
        await storage.storeOrder(makeOrder({id: 1n, position: 10n, status: CANCELED}))
        const all = await pageOrders(storage, 'loadArchivedOrders', {}, 1)
        expect(all.map(o => [o.id, o.status])).toEqual([[3n, FILLED], [2n, FILLED], [1n, CANCELED]])
    })

    test('archived order positions are compared as BigInt', async () => {
        const storage = new InMemoryHistoryStorage()
        for (const position of [9n, big + 1n, 10n, big * big, 100n, big]) {
            await storage.storeOrder(makeOrder({id: position, position, status: FILLED}))
        }
        const expected = [big * big, big + 1n, big, 100n, 10n, 9n]
        expect((await storage.loadArchivedOrders({limit: 10})).map(o => o.position)).toEqual(expected)
        expect((await pageOrders(storage, 'loadArchivedOrders', {}, 2)).map(o => o.position)).toEqual(expected)
        expect((await storage.loadArchivedOrders({limit: 10, cursor: big + 1n})).map(o => o.position)).toEqual([big, 100n, 10n, 9n])
    })

    test('archived order paging applies owner, pair and status filters across page boundaries', async () => {
        const storage = new InMemoryHistoryStorage()
        const records = [
            [7n, 'X', 'S', 'B', FILLED],
            [3n, 'Y', 'S', 'B', FILLED],
            [5n, 'X', 'P', 'Q', CANCELED],
            [1n, 'X', 'B', 'S', EXPIRED],
            [6n, 'X', 'S', 'B', EXPIRED],
            [2n, 'X', 'S', 'B', FILLED],
            [4n, 'Y', 'B', 'S', EXPIRED]
        ]
        for (const [position, owner, selling, buying, status] of records) {
            await storage.storeOrder(makeOrder({id: position, position, owner, selling, buying, status}))
        }
        const positions = async filter => (await pageOrders(storage, 'loadArchivedOrders', filter, 2)).map(o => o.position)
        expect(await positions({owner: 'X'})).toEqual([7n, 6n, 5n, 2n, 1n])
        expect(await positions({pair: 'B/S'})).toEqual([7n, 6n, 4n, 3n, 2n, 1n])
        expect(await positions({status: EXPIRED})).toEqual([6n, 4n, 1n])
        expect(await positions({owner: 'X', pair: 'B/S', status: FILLED})).toEqual([7n, 2n])
    })

    test('active orders are served by position after a revival or an id reuse', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, position: 10n}))
        await storage.storeOrder(makeOrder({id: 2n, position: 20n}))
        await storage.storeOrder(makeOrder({id: 3n, position: 30n}))
        //order 1 expires and is revived by its owner (same record back to the active set)
        await storage.storeOrder(makeOrder({id: 1n, position: 10n, status: EXPIRED}))
        await storage.storeOrder(makeOrder({id: 1n, position: 10n, status: ACTIVE}))
        //order 2 expires, then a new order reuses its id
        await storage.storeOrder(makeOrder({id: 2n, position: 20n, status: EXPIRED}))
        await storage.storeOrder(makeOrder({id: 2n, position: 40n}))
        //an active record replaced in place by a newer one under the same id
        await storage.storeOrder(makeOrder({id: 3n, position: 50n}))
        const expected = [[3n, 50n], [2n, 40n], [1n, 10n]]
        expect((await storage.loadActiveOrders({limit: 10})).map(o => [o.id, o.position])).toEqual(expected)
        for (const limit of [1, 2]) {
            const all = await pageOrders(storage, 'loadActiveOrders', {}, limit)
            expect(all.map(o => [o.id, o.position])).toEqual(expected)
        }
        expect((await storage.loadArchivedOrders({limit: 10})).map(o => [o.id, o.position])).toEqual([[2n, 20n]])
    })

    test('limit 0 returns nothing and a missing limit returns everything', async () => {
        const storage = new InMemoryHistoryStorage()
        for (const position of [2n, 1n, 3n]) {
            await storage.storeOrder(makeOrder({id: position, position, status: FILLED}))
            await storage.storeOrder(makeOrder({id: position + 10n, position: position + 10n}))
            await storage.storeTrade(makeTrade({id: position}))
        }
        expect(await storage.loadArchivedOrders({limit: 0})).toEqual([])
        expect(await storage.loadActiveOrders({limit: 0})).toEqual([])
        expect(await storage.loadTrades({limit: 0})).toEqual([])
        expect((await storage.loadArchivedOrders({})).map(o => o.position)).toEqual([3n, 2n, 1n])
        expect((await storage.loadActiveOrders({})).map(o => o.position)).toEqual([13n, 12n, 11n])
        expect((await storage.loadTrades({})).map(t => t.id)).toEqual([3n, 2n, 1n])
    })

    test('trades and swaps are served by id whatever the arrival order', async () => {
        const storage = new InMemoryHistoryStorage()
        for (const id of [5n, big, 1n, 10n, big + 1n, 2n]) {
            await storage.storeTrade(id % 2n ? makeTrade({id}) : makeSwap({id}))
        }
        const expected = [big + 1n, big, 10n, 5n, 2n, 1n]
        expect((await storage.loadTrades({limit: 10})).map(t => t.id)).toEqual(expected)
        for (const limit of [1, 2, 4]) {
            expect((await pageTrades(storage, {}, limit)).map(t => t.id)).toEqual(expected)
        }
        expect((await storage.loadTrades({limit: 10, cursor: big})).map(t => t.id)).toEqual([10n, 5n, 2n, 1n])
    })

    test('a replayed trade is stored once (the first record is kept)', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n, sold: 100n}), 'c1')
        await storage.storeTrade(makeTrade({id: 2n, sold: 200n}), 'c2')
        await storage.storeTrade(makeTrade({id: 1n, sold: 999n}), 'c3')
        const trades = await pageTrades(storage, {}, 1)
        expect(trades.map(t => [t.id, t.sold])).toEqual([[2n, 200n], [1n, 100n]])
        expect(await storage.getCursor()).toBe('c3')
    })

    test('trade paging applies trader and pair filters across page boundaries', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 6n, maker: 'A', taker: 'B', soldAsset: 'S', boughtAsset: 'B'}))
        await storage.storeTrade(makeSwap({id: 2n, trader: 'A', soldAsset: 'B', boughtAsset: 'S'}))
        await storage.storeTrade(makeTrade({id: 4n, maker: 'C', taker: 'A', soldAsset: 'P', boughtAsset: 'Q'}))
        await storage.storeTrade(makeTrade({id: 1n, maker: 'C', taker: 'D', soldAsset: 'S', boughtAsset: 'B'}))
        await storage.storeTrade(makeSwap({id: 5n, trader: 'A', soldAsset: 'S', boughtAsset: 'B'}))
        await storage.storeTrade(makeTrade({id: 3n, maker: 'A', taker: 'E', soldAsset: 'S', boughtAsset: 'B'}))
        const ids = async filter => (await pageTrades(storage, filter, 2)).map(t => t.id)
        expect(await ids({trader: 'A'})).toEqual([6n, 5n, 4n, 3n, 2n])
        expect(await ids({pair: 'B/S'})).toEqual([6n, 5n, 3n, 2n, 1n])
        expect(await ids({trader: 'A', pair: 'B/S'})).toEqual([6n, 5n, 3n, 2n])
    })
})

describe('HistoryDispatcher paging over InMemoryHistoryStorage', () => {
    const HistoryDispatcher = require('../../src/history/history-dispatcher')
    const big = 2n ** 64n
    const values = [big + 2n, 7n, big * 10n, 30n, big]
    const expected = [big * 10n, big + 2n, big, 30n, 7n].map(String)

    /**
     * Follow the `cursor` field of the last serialized row, like an API client
     * @param {function({}): Promise<{cursor: string}[]>} load
     * @param {number} limit
     * @return {Promise<string[]>}
     */
    async function pageRows(load, limit) {
        const res = []
        let cursor
        for (let i = 0; i < 50; i++) {
            const rows = await load({limit: String(limit), cursor})
            res.push(...rows.map(row => row.cursor))
            if (rows.length < limit)
                return res
            cursor = rows[rows.length - 1].cursor
        }
        throw new Error('Paging did not terminate')
    }

    test('/order-history pages archived orders by position', async () => {
        const storage = new InMemoryHistoryStorage()
        for (const position of values) {
            await storage.storeOrder(makeOrder({id: position, position, status: Order.ORDER_STATUS.FILLED}))
        }
        const dispatcher = new HistoryDispatcher(storage)
        expect(await pageRows(f => dispatcher.loadOrdersHistory(f), 2)).toEqual(expected)
    })

    test('/trades pages trades and swaps by id', async () => {
        const storage = new InMemoryHistoryStorage()
        for (const id of values) {
            await storage.storeTrade(makeTrade({id}))
        }
        const dispatcher = new HistoryDispatcher(storage)
        expect(await pageRows(f => dispatcher.loadTradesHistory(f), 2)).toEqual(expected)
    })

    test('/failures pages failed transactions by id and validates the filters', async () => {
        const storage = new InMemoryHistoryStorage()
        for (const id of values) {
            await storage.storeFailure(Failure.fromEvent({id, txHash: 'h', ledger: 1, ts: 1, fn: 'trade', caller: 'GCALLER', result: 'trapped', reason: 'unknown'}))
        }
        //a replayed failure is stored once
        await storage.storeFailure(Failure.fromEvent({id: values[0], txHash: 'h', ledger: 1, ts: 1, fn: 'swap', caller: 'GCALLER', result: 'trapped'}))
        const dispatcher = new HistoryDispatcher(storage)
        expect(await pageRows(f => dispatcher.loadFailures(f), 2)).toEqual(expected)
        await expect(dispatcher.loadFailures({account: 'nope'})).rejects.toThrow()
        await expect(dispatcher.loadFailures({fn: 'Trade!'})).rejects.toThrow()
        expect(await dispatcher.loadFailures({fn: 'swap'})).toEqual([])
    })
})
