const OrderbookMarketsList = require('../../src/graph/orderbook-markets-list')
const AssetMarkets = require('../../src/graph/asset-market')
const {makeOrder} = require('../helpers/order-factory')

describe('OrderbookMarketsList', () => {
    test('add stores pairs in canonical order (contract Address order)', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        expect(list.markets).toEqual([['A', 'B']])
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
            expect(pair[0] <= pair[1]).toBe(true)
        }
    })

    test('add keeps pairs sorted in canonical order', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'C')
        list.add('A', 'B')
        list.add('A', 'D')
        expect(list.markets).toEqual([
            ['A', 'B'],
            ['A', 'C'],
            ['A', 'D']
        ])
    })

    test('add is idempotent for an existing pair', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        list.add('B', 'A')
        list.add('A', 'B')
        expect(list.markets).toEqual([['A', 'B']])
    })

    test('range returns the first N entries when no cursor is supplied', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        list.add('A', 'C')
        list.add('A', 'D')
        const page = list.range(undefined, 2)
        expect(page).toEqual([
            ['A', 'B'],
            ['A', 'C']
        ])
    })

    test('range resumes after the cursor (exclusive)', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        list.add('A', 'C')
        list.add('A', 'D')
        const page = list.range(['A', 'C'], 10)
        expect(page).toEqual([['A', 'D']])
    })

    test('range with an unknown cursor falls back to the start', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        list.add('A', 'C')
        const page = list.range(['Y', 'Z'], 10)
        expect(page).toEqual([
            ['A', 'B'],
            ['A', 'C']
        ])
    })

    test('range with limit 0 returns an empty slice', () => {
        const list = new OrderbookMarketsList()
        list.add('A', 'B')
        expect(list.range(undefined, 0)).toEqual([])
    })
})
