const InMemoryHistoryStorage = require('../../src/history/inmemory-history-storage')
const Order = require('../../src/entries/order')
const Trade = require('../../src/entries/trade')
const Swap = require('../../src/entries/swap')
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
        expect((await storage.loadActiveOrders({limit: 10, pair: 'S/B'})).map(o => o.id)).toEqual([2n, 1n])
        expect((await storage.loadActiveOrders({limit: 10, cursor: 2n})).map(o => o.id)).toEqual([2n, 1n])
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

    test('loadTrades skips trades with id greater than the cursor', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n}))
        await storage.storeTrade(makeTrade({id: 2n}))
        await storage.storeTrade(makeTrade({id: 3n}))
        const trades = await storage.loadTrades({limit: 10, cursor: 2n})
        expect(trades.map(t => t.id)).toEqual([2n, 1n])
    })

    test('loadArchivedOrders filters by owner', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, owner: 'X', status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 2n, owner: 'Y', status: Order.ORDER_STATUS.CANCELED}))
        await storage.storeOrder(makeOrder({id: 3n, owner: 'X', status: Order.ORDER_STATUS.FILLED}))
        const orders = await storage.loadArchivedOrders({limit: 10, owner: 'X'})
        expect(orders.map(o => o.id)).toEqual([3n, 1n])
    })

    test('loadArchivedOrders honors cursor', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 2n, status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 3n, status: Order.ORDER_STATUS.FILLED}))
        const orders = await storage.loadArchivedOrders({limit: 10, cursor: 2n})
        expect(orders.map(o => o.id)).toEqual([2n, 1n])
    })

    test('loadArchivedOrders filters by pair (matched against toPair(selling, buying))', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, selling: 'S', buying: 'B', status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 2n, selling: 'X', buying: 'Y', status: Order.ORDER_STATUS.FILLED}))
        const orders = await storage.loadArchivedOrders({limit: 10, pair: 'S/B'})
        expect(orders.map(o => o.id)).toEqual([1n])
    })

    test('loadTrades filters by pair (matched against toPair(soldAsset, boughtAsset))', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n, soldAsset: 'S', boughtAsset: 'B'}))
        await storage.storeTrade(makeTrade({id: 2n, soldAsset: 'X', boughtAsset: 'Y'}))
        const trades = await storage.loadTrades({limit: 10, pair: 'S/B'})
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
