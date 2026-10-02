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
    order.buying = overrides.buying ?? 'B'
    order.selling = overrides.selling ?? 'S'
    order.price = overrides.price ?? 10n
    order.quote = overrides.quote ?? 100n
    order.amount = overrides.amount ?? 100n
    order.owner = overrides.owner ?? 'OWNER'
    order.expires = overrides.expires ?? 0
    order.created = overrides.created ?? 1_700_000_000
    order.updated = overrides.updated ?? order.created
    //creation ordinal defaults to the id so that simple tests can reason about pagination by id
    order.position = overrides.position ?? order.id
    order.cursor = overrides.cursor ?? order.position.toString()
    return order
}

module.exports = {makeOrder}
