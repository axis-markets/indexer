const {Keypair} = require('@stellar/stellar-base')
const OrderBookDispatcher = require('../../src/graph/orderbook-dispatcher')
const {makeOrder} = require('../helpers/order-factory')

describe('OrderBookDispatcher.update', () => {
    test('"created" inserts the order into the graph', () => {
        const dispatcher = new OrderBookDispatcher()
        const order = makeOrder({id: 7n})
        dispatcher.update('created', order)
        expect(dispatcher.graph.getOrder(7n)).toBe(order)
    })

    test('"updated" mutates amount and updated timestamp of the existing order', () => {
        const dispatcher = new OrderBookDispatcher()
        const initial = makeOrder({id: 7n, amount: 100n, updated: 1_700_000_000_000})
        dispatcher.update('created', initial)

        const patch = makeOrder({id: 7n, amount: 25n, updated: 1_800_000_000_000})
        dispatcher.update('updated', patch)

        const stored = dispatcher.graph.getOrder(7n)
        expect(stored).toBe(initial)
        expect(stored.amount).toBe(25n)
        expect(stored.updated).toBe(1_800_000_000_000)
    })

    test('"updated" for an unknown order is logged but does not throw', () => {
        const dispatcher = new OrderBookDispatcher()
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        expect(() => dispatcher.update('updated', makeOrder({id: 99n}))).not.toThrow()
        expect(errSpy).toHaveBeenCalled()
        errSpy.mockRestore()
    })

    test('throws on unknown action type', () => {
        const dispatcher = new OrderBookDispatcher()
        expect(() => dispatcher.update('bogus', makeOrder())).toThrow(/Unknown order update action/)
    })
})

describe('OrderBookDispatcher.getOrder', () => {
    test('returns the serialized order when present', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.update('created', makeOrder({id: 42n, owner: 'OWNER-A'}))
        const serialized = dispatcher.getOrder('42')
        expect(serialized).toMatchObject({
            id: '42',
            kind: 'LIMIT',
            status: 'ACTIVE',
            owner: 'OWNER-A'
        })
    })

    test('returns null when the order is not in the graph', () => {
        const dispatcher = new OrderBookDispatcher()
        expect(dispatcher.getOrder(123n)).toBeNull()
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

    test('rejects non-positive ids with a 400 error', () => {
        const dispatcher = new OrderBookDispatcher()
        try {
            dispatcher.getOrder('0')
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

    test('returns serialized orders with a cursor and respects limit', () => {
        const dispatcher = new OrderBookDispatcher()
        for (let i = 1; i <= 3; i++) {
            dispatcher.update('created', makeOrder({id: BigInt(i), owner: 'OWNER'}))
        }
        const res = dispatcher.getOrders({limit: 2})
        expect(res).toHaveLength(2)
        expect(res[0]).toMatchObject({id: '1', cursor: '1'})
        expect(res[1]).toMatchObject({id: '2', cursor: '2'})
    })

    test('filters by owner', () => {
        const dispatcher = new OrderBookDispatcher()
        const ownerA = Keypair.random().publicKey()
        const ownerB = Keypair.random().publicKey()
        dispatcher.update('created', makeOrder({id: 1n, owner: ownerA}))
        dispatcher.update('created', makeOrder({id: 2n, owner: ownerB}))
        const res = dispatcher.getOrders({owner: ownerA})
        expect(res.map(o => o.id)).toEqual(['1'])
    })

    test('skips orders at or before the cursor', () => {
        const dispatcher = new OrderBookDispatcher()
        for (let i = 1; i <= 3; i++) {
            dispatcher.update('created', makeOrder({id: BigInt(i)}))
        }
        const res = dispatcher.getOrders({cursor: '2'})
        expect(res.map(o => o.id)).toEqual(['3'])
    })
})

describe('OrderBookDispatcher.getMarkets', () => {
    test('returns an empty array when no orders exist', () => {
        const dispatcher = new OrderBookDispatcher()
        expect(dispatcher.getMarkets({})).toEqual([])
    })

    test('returns serialized markets in canonical sorted order', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.update('created', makeOrder({id: 1n, selling: 'S', buying: 'B'}))
        dispatcher.update('created', makeOrder({id: 2n, selling: 'S', buying: 'C'}))
        const res = dispatcher.getMarkets({limit: 10})
        expect(res).toEqual([
            {baseAsset: 'S', quoteAsset: 'B', cursor: 'S-B', orderTypes: ['LIMIT']},
            {baseAsset: 'S', quoteAsset: 'C', cursor: 'S-C', orderTypes: ['LIMIT']}
        ])
    })

    test('paginates with a cursor (exclusive)', () => {
        const dispatcher = new OrderBookDispatcher()
        dispatcher.update('created', makeOrder({id: 1n, selling: 'S', buying: 'B'}))
        dispatcher.update('created', makeOrder({id: 2n, selling: 'S', buying: 'C'}))
        dispatcher.update('created', makeOrder({id: 3n, selling: 'S', buying: 'D'}))
        const page = dispatcher.getMarkets({cursor: 'S-B', limit: 10})
        expect(page.map(m => m.cursor)).toEqual(['S-C', 'S-D'])
    })

    test('rejects a cursor with the wrong number of segments', () => {
        const dispatcher = new OrderBookDispatcher()
        expect(() => dispatcher.getMarkets({cursor: 'bad'})).toThrow(/Invalid parameter: "cursor"/)
    })
})
