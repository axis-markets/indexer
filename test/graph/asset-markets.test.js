const AssetMarkets = require('../../src/graph/asset-market')
const {makeOrder} = require('../helpers/order-factory')

describe('AssetMarkets (selling side)', () => {
    test('groups orders by counter asset, sorted cheapest-first', () => {
        const markets = new AssetMarkets('S', 'selling')
        const a = makeOrder({id: 1n, selling: 'S', buying: 'B', price: 30n})
        const b = makeOrder({id: 2n, selling: 'S', buying: 'B', price: 10n})
        const c = makeOrder({id: 3n, selling: 'S', buying: 'B', price: 20n})
        markets.addOrder(a)
        markets.addOrder(b)
        markets.addOrder(c)

        const orders = markets.get('B')
        expect(orders.map(o => o.id)).toEqual([2n, 3n, 1n])
        expect(markets.size).toBe(1)
        expect(markets.hasMarkets).toBe(true)
        expect([...markets.counterAssets]).toEqual(['B'])
    })

    test('separates orders by counter asset', () => {
        const markets = new AssetMarkets('S', 'selling')
        markets.addOrder(makeOrder({id: 1n, selling: 'S', buying: 'B', price: 10n}))
        markets.addOrder(makeOrder({id: 2n, selling: 'S', buying: 'C', price: 5n}))
        expect(markets.size).toBe(2)
        expect(markets.get('B').map(o => o.id)).toEqual([1n])
        expect(markets.get('C').map(o => o.id)).toEqual([2n])
    })

    test('removeOrder drops the order and prunes empty buckets', () => {
        const markets = new AssetMarkets('S', 'selling')
        const order = makeOrder({id: 1n, selling: 'S', buying: 'B', price: 10n})
        markets.addOrder(order)
        expect(markets.removeOrder(order)).toBe(true)
        expect(markets.size).toBe(0)
        expect(markets.hasMarkets).toBe(false)
    })

    test('removeOrder returns false for an unknown order', () => {
        const markets = new AssetMarkets('S', 'selling')
        const ghost = makeOrder({id: 99n, selling: 'S', buying: 'B'})
        expect(markets.removeOrder(ghost)).toBe(false)
    })
})

describe('AssetMarkets (buying side)', () => {
    test('sorts orders most-expensive-first', () => {
        const markets = new AssetMarkets('B', 'buying')
        const a = makeOrder({id: 1n, selling: 'S', buying: 'B', price: 10n})
        const b = makeOrder({id: 2n, selling: 'S', buying: 'B', price: 30n})
        const c = makeOrder({id: 3n, selling: 'S', buying: 'B', price: 20n})
        markets.addOrder(a)
        markets.addOrder(b)
        markets.addOrder(c)
        expect(markets.get('S').map(o => o.id)).toEqual([2n, 3n, 1n])
    })
})
