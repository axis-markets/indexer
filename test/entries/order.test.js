const Order = require('../../src/entries/order')
const {makeOrder} = require('../helpers/order-factory')
const {formatDateUTC} = require('../../src/utils/date')

describe('Order.toJSON', () => {
    test('serializes BigInt fields as strings and maps the status', () => {
        const order = makeOrder({
            id: 42n,
            status: Order.ORDER_STATUS.FILLED,
            buying: 'B',
            selling: 'S',
            price: 10n ** 18n,
            quote: 1_000n,
            amount: 500n,
            owner: 'OWNER',
            expires: 1_700_000_000,
            position: 77n
        })
        const json = order.toJSON()
        expect(json).toEqual({
            id: '42',
            status: 'FILLED',
            buying: 'B',
            selling: 'S',
            price: '1000000000000000000',
            rprice: 1,
            quote: '1000',
            amount: '500',
            owner: 'OWNER',
            expires: formatDateUTC(new Date(1_700_000_000_000)),
            created: formatDateUTC(new Date(1_700_000_000_000)),
            updated: formatDateUTC(new Date(1_700_000_000_000)),
            cursor: '77'
        })
    })

    test('omits expires when zero', () => {
        expect(makeOrder({expires: 0}).toJSON().expires).toBeUndefined()
    })

    test('includes the backed amount and backing details when provided', () => {
        const order = makeOrder({amount: 500n})
        const json = order.toJSON({balance: 800n, allowance: 300n, liveUntil: 1000, authorized: true, budget: 300n, updated: 1_700_000_000_000})
        expect(json.backed).toBe('300')
        expect(json.backing).toEqual({
            balance: '800',
            allowance: '300',
            liveUntil: 1000,
            authorized: true,
            updated: formatDateUTC(new Date(1_700_000_000_000))
        })
    })

    test('caps the backed amount at the order amount', () => {
        const json = makeOrder({amount: 500n}).toJSON({balance: 800n, allowance: 900n, liveUntil: 0, authorized: true, budget: 800n, updated: 0})
        expect(json.backed).toBe('500')
        expect(json.backing.updated).toBeUndefined()
    })

    test('JSON.stringify uses toJSON automatically', () => {
        const order = makeOrder({id: 1n, status: Order.ORDER_STATUS.FILLED})
        const parsed = JSON.parse(JSON.stringify(order))
        expect(parsed.id).toBe('1')
        expect(parsed.status).toBe('FILLED')
        expect(parsed.kind).toBeUndefined()
    })
})

describe('Order.fromCreatedEvent', () => {
    test('builds an ACTIVE order keeping the initial amount as quote', () => {
        const order = Order.fromCreatedEvent({
            action: 'new',
            id: 12345678901234567890123456789n,
            owner: 'OWNER',
            selling: 'S',
            buying: 'B',
            price: 10n,
            amount: 100n,
            position: 500n,
            ledger: 7,
            cursor: '30064771072-0000',
            ts: 1_700_000_000
        })
        expect(order.status).toBe(Order.ORDER_STATUS.ACTIVE)
        expect(order.id).toBe(12345678901234567890123456789n)
        expect(order.quote).toBe(100n)
        expect(order.amount).toBe(100n)
        expect(order.created).toBe(1_700_000_000)
        expect(order.updated).toBe(1_700_000_000)
        expect(order.position).toBe(500n)
        expect(order.cursor).toBe('30064771072-0000')
        expect(order.expires).toBe(0)
    })

    test('takes the expiration from the event', () => {
        const order = Order.fromCreatedEvent({
            action: 'new', id: 1n, owner: 'OWNER', selling: 'S', buying: 'B', price: 10n, amount: 100n,
            expires: 1_700_086_400, position: 1n, ledger: 7, cursor: '1-0000', ts: 1_700_000_000
        })
        expect(order.expires).toBe(1_700_086_400)
    })
})

describe('Order.applyFill', () => {
    test('partial fill keeps the order active and patches the amount', () => {
        const order = makeOrder({amount: 100n})
        order.applyFill(40n, 1_700_000_100)
        expect(order.amount).toBe(40n)
        expect(order.status).toBe(Order.ORDER_STATUS.ACTIVE)
        expect(order.updated).toBe(1_700_000_100)
        expect(order.quote).toBe(100n)
    })

    test('a fill to zero marks the order FILLED', () => {
        const order = makeOrder({amount: 100n})
        order.applyFill(0n, 1_700_000_100)
        expect(order.amount).toBe(0n)
        expect(order.status).toBe(Order.ORDER_STATUS.FILLED)
    })
})

describe('Order.applyMod', () => {
    test('sets the new price, amount and expiration', () => {
        const order = makeOrder({price: 10n, amount: 100n})
        order.applyMod(12n, 80n, 1_700_050_000, 1_700_000_100)
        expect(order.price).toBe(12n)
        expect(order.amount).toBe(80n)
        expect(order.expires).toBe(1_700_050_000)
        expect(order.status).toBe(Order.ORDER_STATUS.ACTIVE)
        expect(order.updated).toBe(1_700_000_100)
    })

    test('isExpired compares a set expiration with the current time', () => {
        expect(makeOrder({expires: 0}).isExpired(2_000_000_000)).toBe(false)
        expect(makeOrder({expires: 1_700_000_000}).isExpired(1_699_999_999)).toBe(false)
        expect(makeOrder({expires: 1_700_000_000}).isExpired(1_700_000_000)).toBe(true)
    })

    test('applyExpiration marks the order EXPIRED at its expiration time', () => {
        const order = makeOrder({expires: 1_700_000_000, updated: 1_699_000_000})
        order.applyExpiration()
        expect(order.status).toBe(Order.ORDER_STATUS.EXPIRED)
        expect(order.updated).toBe(1_700_000_000)
        expect(order.toJSON().status).toBe('EXPIRED')
    })

    test('an update revives an expired order', () => {
        const order = makeOrder({expires: 1_700_000_000})
        order.applyExpiration()
        order.applyMod(10n, 50n, 0, 1_700_000_100)
        expect(order.status).toBe(Order.ORDER_STATUS.ACTIVE)
        expect(order.expires).toBe(0)
    })

    test('zero amount marks the order CANCELED and keeps the last known amount and price', () => {
        const order = makeOrder({price: 10n, amount: 60n})
        order.applyMod(10n, 0n, 0, 1_700_000_100)
        expect(order.status).toBe(Order.ORDER_STATUS.CANCELED)
        expect(order.amount).toBe(60n)
        expect(order.price).toBe(10n)
    })
})
