const Order = require('../../src/entries/order')
const {makeOrder} = require('../helpers/order-factory')
const {formatDateUTC} = require('../../src/utils/date')

describe('Order.toJSON', () => {
    test('serializes BigInt fields as strings and maps enums', () => {
        const order = makeOrder({
            id: 42n,
            status: Order.ORDER_STATUS.FILLED,
            kind: Order.ORDER_KIND.LIMIT,
            buying: 'B',
            selling: 'S',
            price: 10n ** 18n,
            quote: 1_000n,
            amount: 500n,
            owner: 'OWNER',
            expires: 1_700_000_000_000
        })
        const json = order.toJSON()
        expect(json).toMatchObject({
            id: '42',
            status: 'FILLED',
            kind: 'LIMIT',
            buying: 'B',
            selling: 'S',
            price: '1000000000000000000',
            rprice: 1,
            quote: '1000',
            amount: '500',
            owner: 'OWNER',
            expires:formatDateUTC(new Date(1_700_000_000_000))
        })
    })

    test('omits iceberg and stop when zero', () => {
        const json = makeOrder({iceberg: 0n, stop: 0n}).toJSON()
        expect(json.iceberg).toBeUndefined()
        expect(json.stop).toBeUndefined()
    })

    test('includes iceberg and stop when set', () => {
        const json = makeOrder({iceberg: 5n, stop: 7n}).toJSON()
        expect(json.iceberg).toBe('5')
        expect(json.stop).toBe('7')
    })

    test('JSON.stringify uses toJSON automatically', () => {
        const order = makeOrder({id: 1n, status: Order.ORDER_STATUS.FILLED})
        const parsed = JSON.parse(JSON.stringify(order))
        expect(parsed.id).toBe('1')
        expect(parsed.status).toBe('FILLED')
    })
})

describe('Order.fromEvent', () => {
    /**
     * @param {Partial<OrderEvent>} overrides
     * @return {OrderEvent}
     */
    function makeEvent(overrides = {}) {
        return {
            id: 1n,
            action: 'created',
            kind: 1,
            buying: 'B',
            selling: 'S',
            price: 10n,
            quote: 100n,
            amount: 100n,
            owner: 'OWNER',
            expires: 0,
            cursor: '1',
            ts: 1_700_000_000_000,
            ...overrides
        }
    }

    test('created event yields an ACTIVE order and sets created timestamp', () => {
        const order = Order.fromEvent(makeEvent({action: 'created', ts: 1_700_000_000_000}))
        expect(order.status).toBe(Order.ORDER_STATUS.ACTIVE)
        expect(order.created).toBe(1_700_000_000_000)
        expect(order.updated).toBe(1_700_000_000_000)
    })

    test('updated event yields an ACTIVE order without resetting created', () => {
        const order = Order.fromEvent(makeEvent({action: 'updated'}))
        expect(order.status).toBe(Order.ORDER_STATUS.ACTIVE)
        expect(order.created).toBeUndefined()
    })

    test('removed event with remaining amount is CANCELED', () => {
        const order = Order.fromEvent(makeEvent({action: 'removed', amount: 50n}))
        expect(order.status).toBe(Order.ORDER_STATUS.CANCELED)
    })

    test('removed event with zero amount is FILLED', () => {
        const order = Order.fromEvent(makeEvent({action: 'removed', amount: 0n}))
        expect(order.status).toBe(Order.ORDER_STATUS.FILLED)
    })
})
