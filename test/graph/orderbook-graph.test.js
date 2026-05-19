const OrderBookGraph = require('../../src/graph/orderbook-graph')
const {makeOrder} = require('../helpers/order-factory')

describe('OrderBookGraph', () => {
    test('starts empty with ledger 0', () => {
        const graph = new OrderBookGraph()
        expect(graph.isEmpty).toBe(true)
        expect(graph.lastLedger).toBe(0)
        expect(graph.allOrders.size).toBe(0)
    })

    test('addOrder inserts a new order into both sides and the index', () => {
        const graph = new OrderBookGraph()
        const order = makeOrder({id: 1n, selling: 'S', buying: 'B', price: 10n})
        graph.addOrder(order)
        expect(graph.isEmpty).toBe(false)
        expect(graph.getOrder(1n)).toBe(order)
        expect(graph.allOrders.size).toBe(1)
    })

    test('addOrder updates the amount in place when assets and price match', () => {
        const graph = new OrderBookGraph()
        const initial = makeOrder({id: 1n, selling: 'S', buying: 'B', price: 10n, amount: 100n})
        graph.addOrder(initial)
        const update = makeOrder({id: 1n, selling: 'S', buying: 'B', price: 10n, amount: 40n})
        graph.addOrder(update)
        expect(graph.allOrders.size).toBe(1)
        expect(graph.getOrder(1n)).toBe(initial)
        expect(graph.getOrder(1n).amount).toBe(40n)
    })

    test('updateLastLedger advances the ledger pointer', () => {
        const graph = new OrderBookGraph()
        graph.updateLastLedger(123)
        expect(graph.lastLedger).toBe(123)
        graph.updateLastLedger(456)
        expect(graph.lastLedger).toBe(456)
    })

    test('init resets state', () => {
        const graph = new OrderBookGraph()
        graph.addOrder(makeOrder({id: 1n}))
        graph.updateLastLedger(10)
        graph.init()
        expect(graph.isEmpty).toBe(true)
        expect(graph.lastLedger).toBe(0)
    })

    test('getOrder returns undefined for unknown ids', () => {
        const graph = new OrderBookGraph()
        expect(graph.getOrder(999n)).toBeUndefined()
    })

    test('removeOrder drops the order from both sides', () => {
        const graph = new OrderBookGraph()
        const a = makeOrder({id: 1n, selling: 'S', buying: 'B', price: 10n})
        const b = makeOrder({id: 2n, selling: 'S', buying: 'B', price: 20n})
        graph.addOrder(a)
        graph.addOrder(b)
        expect(graph.removeOrder(1n)).toBe(true)
        expect(graph.getOrder(1n)).toBeUndefined()
        expect(graph.allOrders.size).toBe(1)
        expect(graph.removeOrder(2n)).toBe(true)
        expect(graph.isEmpty).toBe(true)
    })

    test('removeOrder returns false for unknown ids', () => {
        const graph = new OrderBookGraph()
        expect(graph.removeOrder(999n)).toBe(false)
    })

    test('addOrder relocates the order when assets or price change', () => {
        const graph = new OrderBookGraph()
        const initial = makeOrder({id: 1n, selling: 'S', buying: 'B', price: 10n, amount: 100n})
        graph.addOrder(initial)
        const moved = makeOrder({id: 1n, selling: 'S', buying: 'B', price: 25n, amount: 100n})
        graph.addOrder(moved)
        expect(graph.allOrders.size).toBe(1)
        expect(graph.getOrder(1n)).toBe(moved)
        expect(graph.getOrder(1n).price).toBe(25n)
    })
})
