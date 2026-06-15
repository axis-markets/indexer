const OrderbookMarketsList = require('../../src/graph/orderbook-markets-list')
const AssetMarkets = require('../../src/graph/asset-market')
const {makeOrder} = require('../helpers/order-factory')

describe('OrderbookMarketsList', () => {
    test('add stores pairs in canonical order (larger asset first)', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        expect(list.markets).toEqual([['B', 'A']])
    })

    test('add freezes each stored pair', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        expect(Object.isFrozen(list.markets[0])).toBe(true)
    })

    test('loadFromMarkets flattens an iterator of AssetMarkets entries', () => {
        const m1 = new AssetMarkets('S', 'selling')
        m1.addOrder(makeOrder({id: 1n, selling: 'S', buying: 'B', price: 1n}))
        m1.addOrder(makeOrder({id: 2n, selling: 'S', buying: 'C', price: 1n}))

        const list = new OrderbookMarketsList().loadFromMarkets([m1].values())
        expect(list.markets.length).toBe(2)
        for (const pair of list.markets) {
            expect(pair[0] >= pair[1]).toBe(true)
        }
    })

    test('add keeps pairs sorted lexicographically', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'C')
        list.add('A', 'B')
        list.add('A', 'D')
        expect(list.markets).toEqual([
            ['B', 'A'],
            ['C', 'A'],
            ['D', 'A']
        ])
    })

    test('add is idempotent for an existing pair', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        list.add('B', 'A')
        list.add('A', 'B')
        expect(list.markets).toEqual([['B', 'A']])
    })

    test('range returns the first N entries when no cursor is supplied', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        list.add('A', 'C')
        list.add('A', 'D')
        const page = list.range(undefined, 2)
        expect(page).toEqual([
            ['B', 'A'],
            ['C', 'A']
        ])
    })

    test('range resumes after the cursor (exclusive)', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        list.add('A', 'C')
        list.add('A', 'D')
        const page = list.range(['C', 'A'], 10)
        expect(page).toEqual([['D', 'A']])
    })

    test('range with an unknown cursor falls back to the start', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        list.add('A', 'C')
        const page = list.range(['Z', 'Y'], 10)
        expect(page).toEqual([
            ['B', 'A'],
            ['C', 'A']
        ])
    })

    test('range with limit 0 returns an empty slice', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        expect(list.range(undefined, 0)).toEqual([])
    })
})
