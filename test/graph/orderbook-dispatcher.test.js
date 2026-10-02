const {Keypair} = require('@stellar/stellar-sdk')
const OrderBookDispatcher = require('../../src/graph/orderbook-dispatcher')
const Order = require('../../src/entries/order')
const {makeOrder} = require('../helpers/order-factory')

const OWNER = Keypair.random().publicKey()
const ASSET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'

describe('OrderBookDispatcher.add', () => {
    test('inserts the order into the graph', () => {
        const dispatcher = new OrderBookDispatcher()
        const order = makeOrder({id: 7n})
        dispatcher.add(order)
        expect(dispatcher.graph.getOrder(7n)).toBe(order)
    })
})

describe('OrderBookDispatcher.fill', () => {
    test('patches the amount in place on a partial fill', () => {
        const dispatcher = new OrderBookDispatcher()
        const order = makeOrder({id: 7n, amount: 100n})
        dispatcher.add(order)
        const res = dispatcher.fill(7n, 25n, 1_800_000_000)
        expect(res).toBe(order)
        expect(dispatcher.graph.getOrder(7n)).toBe(order)
        expect(order.amount).toBe(25n)
        expect(order.status).toBe(Order.ORDER_STATUS.ACTIVE)
        expect(order.updated).toBe(1_800_000_000)
    })

    test('removes the order from the graph when nothing is left', () => {
        const dispatcher = new OrderBookDispatcher()
        const order = makeOrder({id: 7n, amount: 100n})
        dispatcher.add(order)
        const res = dispatcher.fill(7n, 0n, 1_800_000_000)
        expect(res.status).toBe(Order.ORDER_STATUS.FILLED)
        expect(dispatcher.graph.getOrder(7n)).toBeUndefined()
        expect(dispatcher.graph.isEmpty).toBe(true)
    })

    test('unknown order is logged and yields undefined', () => {
        const dispatcher = new OrderBookDispatcher()
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        expect(dispatcher.fill(99n, 1n, 1)).toBeUndefined()
        expect(errSpy).toHaveBeenCalled()
        errSpy.mockRestore()
    })
})

describe('OrderBookDispatcher.modify', () => {
    test('re-inserts the order at the new price level', () => {
        const dispatcher = new OrderBookDispatcher()
        const cheap = makeOrder({id: 1n, selling: 'S', buying: 'B', price: 10n})
        const expensive = makeOrder({id: 2n, selling: 'S', buying: 'B', price: 20n})
        dispatcher.add(cheap)
        dispatcher.add(expensive)
        //selling side vector is sorted cheapest first
        const vector = () => dispatcher.graph.sellingGraph.get('B').get('S').map(o => o.id)
        expect(vector()).toEqual([1n, 2n])
        const res = dispatcher.modify(1n, 30n, 50n, 0, 1_800_000_000)
        expect(res).toBe(cheap)
        expect(cheap.price).toBe(30n)
        expect(cheap.amount).toBe(50n)
        expect(vector()).toEqual([2n, 1n])
        expect(dispatcher.graph.allOrders.size).toBe(2)
    })

    test('changes the amount in place when the price is unchanged', () => {
        const dispatcher = new OrderBookDispatcher()
        const order = makeOrder({id: 1n, price: 10n, amount: 100n})
        dispatcher.add(order)
        dispatcher.modify(1n, 10n, 70n, 0, 1_800_000_000)
        expect(dispatcher.graph.getOrder(1n)).toBe(order)
        expect(order.amount).toBe(70n)
    })

    test('zero amount cancels and removes the order', () => {
        const dispatcher = new OrderBookDispatcher()
        const order = makeOrder({id: 1n, amount: 100n})
        dispatcher.add(order)
        const res = dispatcher.modify(1n, 10n, 0n, 0, 1_800_000_000)
        expect(res.status).toBe(Order.ORDER_STATUS.CANCELED)
        expect(res.amount).toBe(100n)
        expect(dispatcher.graph.isEmpty).toBe(true)
    })

    test('unknown order is logged and yields undefined', () => {
        const dispatcher = new OrderBookDispatcher()
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        expect(dispatcher.modify(99n, 1n, 1n, 0, 1)).toBeUndefined()
        expect(errSpy).toHaveBeenCalled()
        errSpy.mockRestore()
    })

    test('sets the new expiration and keeps it on removal', () => {
        const dispatcher = withClock(1000)
        const order = makeOrder({id: 1n, price: 10n, amount: 100n})
        dispatcher.add(order)
        dispatcher.modify(1n, 10n, 70n, 5000, 1001)
        expect(order.expires).toBe(5000)
        dispatcher.modify(1n, 10n, 0n, 5000, 1002)
        expect(order.status).toBe(Order.ORDER_STATUS.CANCELED)
        expect(order.expires).toBe(5000)
    })
})

/**
 * Dispatcher with a fixed clock (UNIX seconds)
 * @param {number} now
 * @return {OrderBookDispatcher}
 */
function withClock(now) {
    const dispatcher = new OrderBookDispatcher()
    dispatcher.clock = () => now
    return dispatcher
}

describe('OrderBookDispatcher expiration', () => {
    const vector = dispatcher => dispatcher.graph.sellingGraph.get('B')?.get('S')?.map(o => o.id) ?? []

    test('expire marks expired orders EXPIRED, hides them from the API and untracks them', () => {
        const dispatcher = withClock(1000)
        const expiring = makeOrder({id: 1n, expires: 2000})
        const open = makeOrder({id: 2n})
        dispatcher.add(expiring)
        dispatcher.add(open)
        expect(dispatcher.graph.backing.get('OWNER', 'S').refs).toBe(2)
        expect(dispatcher.expire(1999)).toEqual([])
        expect(dispatcher.expire(2000)).toEqual([expiring])
        //checked once
        expect(dispatcher.expire(2001)).toEqual([])
        expect(expiring.status).toBe(Order.ORDER_STATUS.EXPIRED)
        expect(vector(dispatcher)).toEqual([2n])
        expect(dispatcher.graph.isLive(1n)).toBe(false)
        //kept in the graph for a revival, but not served
        expect(dispatcher.graph.getOrder(1n)).toBe(expiring)
        expect(() => dispatcher.getOrder(1n)).toThrow(expect.objectContaining({status: 404}))
        expect(dispatcher.getOrders({}).map(o => o.id)).toEqual(['2'])
        expect(dispatcher.graph.isEmpty).toBe(false)
        expect(dispatcher.graph.backing.get('OWNER', 'S').refs).toBe(1)
    })

    test('an order created already expired is kept out of the live orderbook', () => {
        const dispatcher = withClock(3000)
        const order = makeOrder({id: 1n, expires: 2000})
        dispatcher.add(order)
        expect(order.status).toBe(Order.ORDER_STATUS.EXPIRED)
        expect(dispatcher.graph.getOrder(1n)).toBeDefined()
        expect(dispatcher.graph.isLive(1n)).toBe(false)
        expect(dispatcher.graph.isEmpty).toBe(true)
        expect(vector(dispatcher)).toEqual([])
        expect(dispatcher.graph.backing.get('OWNER', 'S')).toBeUndefined()
    })

    test('an update revives an expired order', () => {
        const dispatcher = withClock(3000)
        const order = makeOrder({id: 1n, price: 10n, expires: 2000})
        dispatcher.add(order)
        dispatcher.modify(1n, 20n, 50n, 0, 3001)
        expect(order.status).toBe(Order.ORDER_STATUS.ACTIVE)
        expect(dispatcher.graph.isLive(1n)).toBe(true)
        expect(dispatcher.getOrder(1n).status).toBe('ACTIVE')
        expect(vector(dispatcher)).toEqual([1n])
        expect(order).toMatchObject({price: 20n, amount: 50n, expires: 0})
        expect(dispatcher.graph.backing.get('OWNER', 'S').refs).toBe(1)
    })

    test('removing an expired order does not release its backing twice', () => {
        const dispatcher = withClock(1000)
        dispatcher.add(makeOrder({id: 1n, expires: 2000}))
        dispatcher.add(makeOrder({id: 2n}))
        dispatcher.expire(2000)
        dispatcher.modify(1n, 10n, 0n, 2000, 2001)
        expect(dispatcher.graph.getOrder(1n)).toBeUndefined()
        expect(dispatcher.graph.backing.get('OWNER', 'S').refs).toBe(1)
    })

    test('a new order reusing the id of an expired order replaces it', () => {
        const dispatcher = withClock(1000)
        const expired = makeOrder({id: 1n, expires: 2000, position: 10n})
        dispatcher.add(expired)
        dispatcher.expire(2000)
        const reused = makeOrder({id: 1n, price: 30n, position: 20n})
        expect(dispatcher.add(reused)).toBe(expired)
        expect(dispatcher.graph.getOrder(1n)).toBe(reused)
        expect(dispatcher.graph.isLive(1n)).toBe(true)
        expect(vector(dispatcher)).toEqual([1n])
        expect(dispatcher.graph.backing.get('OWNER', 'S').refs).toBe(1)
    })
})

describe('OrderBookDispatcher.skip', () => {
    test('records the skip on the maker backing of the sold asset and reloads both assets', async () => {
        const loads = []
        const BackingTracker = require('../../src/graph/backing-tracker')
        const backing = new BackingTracker(async (asset, owner) => {
            loads.push(owner + '|' + asset)
            return {balance: 10n, authorized: true, allowance: 10n, liveUntil: 0}
        })
        const dispatcher = new OrderBookDispatcher(backing)
        dispatcher.add(makeOrder({id: 1n, owner: OWNER, selling: 'S', buying: 'B'}))
        await new Promise(resolve => setImmediate(resolve))
        loads.length = 0
        expect(dispatcher.skip(1n, 1_800_000_000).id).toBe(1n)
        await new Promise(resolve => setImmediate(resolve))
        expect(loads.sort()).toEqual([OWNER + '|B', OWNER + '|S'])
        expect(backing.get(OWNER, 'S').skipped).toBe(1_800_000_000)
        expect(backing.get(OWNER, 'B').skipped).toBe(0)
        //an unknown order is ignored
        expect(dispatcher.skip(99n, 1_800_000_001)).toBeUndefined()
    })
})

describe('OrderBookDispatcher.getOrder', () => {
    test('returns the serialized order when present', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.add(makeOrder({id: 42n, owner: 'OWNER-A'}))
        const serialized = dispatcher.getOrder('42')
        expect(serialized).toMatchObject({
            id: '42',
            status: 'ACTIVE',
            owner: 'OWNER-A'
        })
        //backing not loaded yet counts as zero
        expect(serialized.backed).toBe('0')
        expect(serialized.backing.updated).toBeUndefined()
    })

    test('includes the backed amount when the maker backing is tracked', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.add(makeOrder({id: 42n, owner: OWNER, selling: ASSET, amount: 100n}))
        dispatcher.graph.backing.set(OWNER, ASSET, {balance: 60n, authorized: true, allowance: 1000n, liveUntil: 0})
        const serialized = dispatcher.getOrder(42n)
        expect(serialized.backed).toBe('60')
        expect(serialized.backing).toMatchObject({balance: '60', allowance: '1000', authorized: true})
    })

    test('accepts a zero id', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.add(makeOrder({id: 0n}))
        expect(dispatcher.getOrder('0').id).toBe('0')
    })

    test('throws a 404 error when the order is not in the graph', () => {
        const dispatcher = new OrderBookDispatcher()
        try {
            dispatcher.getOrder(123n)
            throw new Error('expected throw')
        } catch (e) {
            expect(e.status).toBe(404)
        }
    })

    test('rejects non-coercible ids with a 400 error', () => {
        const dispatcher = new OrderBookDispatcher()
        try {
            dispatcher.getOrder('not-a-number')
            throw new Error('expected throw')
        } catch (e) {
            expect(e.status).toBe(400)
        }
    })

    test('rejects negative ids with a 400 error', () => {
        const dispatcher = new OrderBookDispatcher()
        try {
            dispatcher.getOrder('-1')
            throw new Error('expected throw')
        } catch (e) {
            expect(e.status).toBe(400)
        }
    })
})

describe('OrderBookDispatcher.getOrders', () => {
    test('rejects an invalid owner', () => {
        const dispatcher = new OrderBookDispatcher()
        expect(() => dispatcher.getOrders({owner: 'not-a-key'})).toThrow(/Invalid parameter: "owner"/)
    })

    test('returns an empty array for an empty graph', () => {
        const dispatcher = new OrderBookDispatcher()
        expect(dispatcher.getOrders({})).toEqual([])
    })

    test('returns serialized orders in creation order with a position cursor and respects limit', () => {
        const dispatcher = new OrderBookDispatcher()
        //hash-like ids in arbitrary order, positions ascending
        dispatcher.add(makeOrder({id: 900n, position: 10n}))
        dispatcher.add(makeOrder({id: 5n, position: 11n}))
        dispatcher.add(makeOrder({id: 300n, position: 12n}))
        const res = dispatcher.getOrders({limit: 2})
        expect(res).toHaveLength(2)
        expect(res[0]).toMatchObject({id: '900', cursor: '10'})
        expect(res[1]).toMatchObject({id: '5', cursor: '11'})
    })

    test('filters by owner', () => {
        const dispatcher = new OrderBookDispatcher()
        const ownerA = Keypair.random().publicKey()
        const ownerB = Keypair.random().publicKey()
        dispatcher.add(makeOrder({id: 1n, owner: ownerA}))
        dispatcher.add(makeOrder({id: 2n, owner: ownerB}))
        const res = dispatcher.getOrders({owner: ownerA})
        expect(res.map(o => o.id)).toEqual(['1'])
    })

    test('skips orders at or before the position cursor', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.add(makeOrder({id: 900n, position: 10n}))
        dispatcher.add(makeOrder({id: 5n, position: 11n}))
        dispatcher.add(makeOrder({id: 300n, position: 12n}))
        const res = dispatcher.getOrders({cursor: '11'})
        expect(res.map(o => o.id)).toEqual(['300'])
    })
})

describe('OrderBookDispatcher.getBacking', () => {
    test('returns the tracked record with the effective budget', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.graph.backing.set(OWNER, ASSET, {balance: 500n, authorized: true, allowance: 200n, liveUntil: 100}, 1_700_000_000_000)
        dispatcher.graph.updateLastLedger(50)
        expect(dispatcher.getBacking({owner: OWNER, asset: ASSET})).toEqual({
            owner: OWNER,
            asset: ASSET,
            balance: '500',
            allowance: '200',
            liveUntil: 100,
            authorized: true,
            budget: '200',
            updated: '2023-11-14 22:13:20'
        })
    })

    test('reports a zero budget once the allowance expired', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.graph.backing.set(OWNER, ASSET, {balance: 500n, authorized: true, allowance: 200n, liveUntil: 100})
        dispatcher.graph.updateLastLedger(101)
        expect(dispatcher.getBacking({owner: OWNER, asset: ASSET}).budget).toBe('0')
    })

    test('throws 404 for an untracked pair and 400 for an invalid owner', () => {
        const dispatcher = new OrderBookDispatcher()
        expect(() => dispatcher.getBacking({owner: OWNER, asset: ASSET})).toThrow(expect.objectContaining({status: 404}))
        expect(() => dispatcher.getBacking({owner: 'nope', asset: ASSET})).toThrow(expect.objectContaining({status: 400}))
    })
})

describe('OrderBookDispatcher.getMarkets', () => {
    test('returns an empty array when no orders exist', () => {
        const dispatcher = new OrderBookDispatcher()
        expect(dispatcher.getMarkets({})).toEqual([])
    })

    test('returns serialized markets in canonical sorted order', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.add(makeOrder({id: 1n, selling: 'S', buying: 'B'}))
        dispatcher.add(makeOrder({id: 2n, selling: 'S', buying: 'C'}))
        const res = dispatcher.getMarkets({limit: 10})
        expect(res).toEqual([
            {baseAsset: 'B', quoteAsset: 'S', cursor: 'B-S', orderTypes: ['LIMIT']},
            {baseAsset: 'C', quoteAsset: 'S', cursor: 'C-S', orderTypes: ['LIMIT']}
        ])
    })

    test('paginates with a cursor (exclusive)', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.add(makeOrder({id: 1n, selling: 'S', buying: 'B'}))
        dispatcher.add(makeOrder({id: 2n, selling: 'S', buying: 'C'}))
        dispatcher.add(makeOrder({id: 3n, selling: 'S', buying: 'D'}))
        const page = dispatcher.getMarkets({cursor: 'B-S', limit: 10})
        expect(page.map(m => m.cursor)).toEqual(['C-S', 'D-S'])
    })

    test('rejects a cursor with the wrong number of segments', () => {
        const dispatcher = new OrderBookDispatcher()
        expect(() => dispatcher.getMarkets({cursor: 'bad'})).toThrow(/Invalid parameter: "cursor"/)
    })
})

describe('OrderBookDispatcher shared backing', () => {
    const OTHER = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

    function setup(budget) {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.graph.backing.set(OWNER, ASSET, {balance: 10_000n, authorized: true, allowance: budget, liveUntil: 0})
        dispatcher.graph.backing.set(OWNER, OTHER, {balance: 0n, authorized: true, allowance: 0n, liveUntil: 0})
        return dispatcher
    }

    test('splits one budget across the orders selling the asset, oldest first', () => {
        const dispatcher = setup(250n)
        dispatcher.add(makeOrder({id: 2n, position: 20n, owner: OWNER, selling: ASSET, buying: OTHER, amount: 100n}))
        dispatcher.add(makeOrder({id: 1n, position: 10n, owner: OWNER, selling: ASSET, buying: OTHER, amount: 200n}))
        dispatcher.add(makeOrder({id: 3n, position: 30n, owner: OWNER, selling: ASSET, buying: OTHER, amount: 100n}))
        const backed = Object.fromEntries(dispatcher.getOrders({owner: OWNER}).map(o => [o.id, o.backed]))
        expect(backed).toEqual({'1': '200', '2': '50', '3': '0'})
        expect(dispatcher.getOrder(2n).backed).toBe('50')
    })

    test('getAccount returns every live order of the owner and the backing per asset', () => {
        const dispatcher = setup(1000n)
        for (let i = 1n; i <= 250n; i++) {
            dispatcher.add(makeOrder({id: i, owner: OWNER, selling: ASSET, buying: OTHER, amount: 1n}))
        }
        dispatcher.add(makeOrder({id: 999n, owner: Keypair.random().publicKey(), selling: ASSET, buying: OTHER}))
        const account = dispatcher.getAccount(OWNER)
        expect(account.address).toBe(OWNER)
        expect(account.orders.length).toBe(250) //not paginated
        expect(account.orders.every(o => o.owner === OWNER && o.backed === '1')).toBe(true)
        expect(Object.keys(account.backing).sort()).toEqual([ASSET, OTHER].sort())
        expect(account.backing[ASSET]).toMatchObject({allowance: '1000', budget: '1000', authorized: true})
    })

    test('getAccount rejects an invalid owner and returns an empty state for an unknown one', () => {
        const dispatcher = setup(0n)
        expect(() => dispatcher.getAccount('nope')).toThrow(expect.objectContaining({status: 400}))
        const unknown = Keypair.random().publicKey()
        expect(dispatcher.getAccount(unknown)).toEqual({address: unknown, ledger: 0, orders: [], backing: {}})
    })

    test('removed and expired orders leave the account state', () => {
        const dispatcher = setup(1000n)
        dispatcher.clock = () => 2000
        dispatcher.add(makeOrder({id: 1n, owner: OWNER, selling: ASSET, buying: OTHER}))
        dispatcher.add(makeOrder({id: 2n, owner: OWNER, selling: ASSET, buying: OTHER, expires: 3000}))
        dispatcher.fill(1n, 0n, 1)
        dispatcher.expire(4000)
        expect(dispatcher.getAccount(OWNER).orders).toEqual([])
        expect(dispatcher.graph.ordersByOwner.get(OWNER).size).toBe(1) //expired, kept for a revival
    })
})
