const Order = require('../../src/entries/order')

/**
 * Build an Order entity with sensible test defaults
 * @param {Partial<Order>} overrides
 * @return {Order}
 */
function makeOrder(overrides = {}) {
    const order = new Order()
    order.id = overrides.id ?? 1n
    order.status = overrides.status ?? Order.ORDER_STATUS.ACTIVE
    order.kind = overrides.kind ?? Order.ORDER_KIND.LIMIT
    order.buying = overrides.buying ?? 'B'
    order.selling = overrides.selling ?? 'S'
    order.price = overrides.price ?? 10n
    order.stop = overrides.stop ?? 0n
    order.quote = overrides.quote ?? 100n
    order.amount = overrides.amount ?? 100n
    order.iceberg = overrides.iceberg ?? 0n
    order.owner = overrides.owner ?? 'OWNER'
    order.expires = overrides.expires ?? 0
    order.created = overrides.created ?? 1_700_000_000_000
    order.updated = overrides.updated ?? order.created
    return order
}

module.exports = {makeOrder}
