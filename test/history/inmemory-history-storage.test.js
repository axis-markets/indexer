const InMemoryHistoryStorage = require('../../src/history/inmemory-history-storage')
const Order = require('../../src/entries/order')
const Trade = require('../../src/entries/trade')
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

describe('InMemoryHistoryStorage', () => {
    test('cursor round-trips through save/getCursor', async () => {
        const storage = new InMemoryHistoryStorage()
        expect(await storage.getCursor()).toBeUndefined()
        await storage.save('cursor-1')
        expect(await storage.getCursor()).toBe('cursor-1')
    })

    test('storeTrade appends to the in-memory log', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n}))
        await storage.storeTrade(makeTrade({id: 2n}))
        const trades = await storage.getTrades({limit: 10})
        expect(trades.map(t => t.id)).toEqual([2n, 1n])
    })

    test('storeOrder rejects an ACTIVE order', async () => {
        const storage = new InMemoryHistoryStorage()
        const active = makeOrder({id: 1n, status: Order.ORDER_STATUS.ACTIVE})
        await expect(storage.storeOrder(active)).rejects.toThrow(/Attempt to archive active order/)
    })

    test('storeOrder accepts a finalized order', async () => {
        const storage = new InMemoryHistoryStorage()
        const filled = makeOrder({id: 1n, status: Order.ORDER_STATUS.FILLED})
        const cancelled = makeOrder({id: 2n, status: Order.ORDER_STATUS.CANCELED})
        await storage.storeOrder(filled)
        await storage.storeOrder(cancelled)
        const orders = await storage.getOrders({limit: 10})
        expect(orders.map(o => o.id)).toEqual([2n, 1n])
    })

    test('getTrades respects limit and returns newest first', async () => {
        const storage = new InMemoryHistoryStorage()
        for (let i = 1; i <= 5; i++) {
            await storage.storeTrade(makeTrade({id: BigInt(i)}))
        }
        const trades = await storage.getTrades({limit: 2})
        expect(trades.map(t => t.id)).toEqual([5n, 4n])
    })

    test('getTrades filters by trader (matches maker or taker)', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n, maker: 'A', taker: 'B'}))
        await storage.storeTrade(makeTrade({id: 2n, maker: 'C', taker: 'A'}))
        await storage.storeTrade(makeTrade({id: 3n, maker: 'D', taker: 'E'}))
        const trades = await storage.getTrades({limit: 10, trader: 'A'})
        expect(trades.map(t => t.id)).toEqual([2n, 1n])
    })

    test('getTrades skips trades with id greater than the cursor', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n}))
        await storage.storeTrade(makeTrade({id: 2n}))
        await storage.storeTrade(makeTrade({id: 3n}))
        const trades = await storage.getTrades({limit: 10, cursor: 2n})
        expect(trades.map(t => t.id)).toEqual([2n, 1n])
    })

    test('getOrders filters by owner', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, owner: 'X', status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 2n, owner: 'Y', status: Order.ORDER_STATUS.CANCELED}))
        await storage.storeOrder(makeOrder({id: 3n, owner: 'X', status: Order.ORDER_STATUS.FILLED}))
        const orders = await storage.getOrders({limit: 10, owner: 'X'})
        expect(orders.map(o => o.id)).toEqual([3n, 1n])
    })

    test('getOrders honors cursor', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 2n, status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 3n, status: Order.ORDER_STATUS.FILLED}))
        const orders = await storage.getOrders({limit: 10, cursor: 2n})
        expect(orders.map(o => o.id)).toEqual([2n, 1n])
    })

    test('getOrders filters by pair (matched against toPair(selling, buying))', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeOrder(makeOrder({id: 1n, selling: 'S', buying: 'B', status: Order.ORDER_STATUS.FILLED}))
        await storage.storeOrder(makeOrder({id: 2n, selling: 'X', buying: 'Y', status: Order.ORDER_STATUS.FILLED}))
        const orders = await storage.getOrders({limit: 10, pair: 'S/B'})
        expect(orders.map(o => o.id)).toEqual([1n])
    })

    test('getTrades filters by pair (matched against toPair(soldAsset, boughtAsset))', async () => {
        const storage = new InMemoryHistoryStorage()
        await storage.storeTrade(makeTrade({id: 1n, soldAsset: 'S', boughtAsset: 'B'}))
        await storage.storeTrade(makeTrade({id: 2n, soldAsset: 'X', boughtAsset: 'Y'}))
        const trades = await storage.getTrades({limit: 10, pair: 'S/B'})
        expect(trades.map(t => t.id)).toEqual([1n])
    })
})
