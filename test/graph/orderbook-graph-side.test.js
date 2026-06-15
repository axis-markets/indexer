const OrderBookGraphSide = require('../../src/graph/orderbook-graph-side')
const {makeOrder} = require('../helpers/order-factory')

describe('OrderBookGraphSide', () => {
    test('selling side indexes orders by the bought asset', () => {
        const side = new OrderBookGraphSide('selling')
        const order = makeOrder({id: 1n, selling: 'S', buying: 'B'})
        side.addOrder(order)
        //keyed by the bought asset; inner vector keyed by the sold asset
        const markets = side.get('B')
        expect(markets).toBeDefined()
        expect(markets.markets.get('S').map(o => o.id)).toEqual([1n])
        expect(side.get('S')).toBeUndefined()
    })

    test('buying side indexes orders by the sold asset', () => {
        const side = new OrderBookGraphSide('buying')
        const order = makeOrder({id: 1n, selling: 'S', buying: 'B'})
        side.addOrder(order)
        const markets = side.get('S')
        expect(markets).toBeDefined()
        expect(markets.markets.get('B').map(o => o.id)).toEqual([1n])
        expect(side.get('B')).toBeUndefined()
    })

    test('get returns undefined for an unknown asset', () => {
        const side = new OrderBookGraphSide('selling')
        expect(side.get('NONE')).toBeUndefined()
    })

    test('removeOrder cleans up the emptied bucket', () => {
        const side = new OrderBookGraphSide('selling')
        const order = makeOrder({id: 1n, selling: 'S', buying: 'B'})
        side.addOrder(order)
        expect(side.removeOrder(order)).toBe(true)
        expect(side.get('B')).toBeUndefined()
    })
})
