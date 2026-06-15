const {toRationalPrice} = require('../utils/price')
const {formatDateUTC} = require('../utils/date')

class Order {
    /**
     * Unique ID
     * @type {bigint}
     */
    id
    /**
     * Current order status
     * @type {Order.ORDER_STATUS}
     */
    status
    /**
     * Order type
     * @type {Order.ORDER_KIND}
     */
    kind
    /**
     * Buying token address
     * @type {string}
     */
    buying
    /**
     * Selling token address
     * @type {string}
     */
    selling
    /**
     * @type {bigint}
     */
    price
    /**
     * Stop price for stop-limit orders
     * @type {bigint}
     */
    stop
    /**
     * Initial selling amount
     * @type {bigint}
     */
    quote
    /**
     * Selling amount left
     * @type {bigint}
     */
    amount
    /**
     * Visible portion amount for iceberg orders
     * @type {bigint}
     */
    iceberg
    /**
     * Maker address
     * @type {string}
     */
    owner
    /**
     * Expiration timestamp, in UNIX milliseconds
     * @type {number}
     */
    expires
    /**
     * Creation timestamp
     * @type {number}
     */
    created
    /**
     * Last update timestamp
     * @type {number}
     */
    updated

    /**
     * Check whether an asset can be trade with the current order
     * @param {string} assetToTrade
     * @deprecated
     */
    canTradeWithAsset(assetToTrade) {
        //can't trade against this order, no matching asset
        if (this.buying !== assetToTrade && this.selling !== assetToTrade)
            return false//throw new Error(`Attempt to trade ${assetToTrade} asset to the order ${this.toString()}`)
        return true
    }

    toString() {
        return `[${this.id}] ${this.buying}/${this.selling} price ${this.price} amount ${this.amount}`
    }

    toJSON() {
        return serializeOrder(this)
    }

    static ORDER_KIND = {
        LIMIT: 1
    }

    static ORDER_STATUS = {
        ACTIVE: 0,
        FILLED: 1,
        CANCELED: 2
    }

    /**
     * @param {OrderEvent} orderEvent
     * @return {Order}
     */
    static fromEvent(orderEvent) {
        const order = new Order()
        order.id = orderEvent.id
        order.kind = ORDER_KIND_MAP[orderEvent.kind]
        order.buying = orderEvent.buying
        order.selling = orderEvent.selling
        order.amount = orderEvent.amount
        order.quote = orderEvent.quote
        order.price = orderEvent.price
        order.owner = orderEvent.owner
        if (orderEvent.action === 'created') {
            order.created = orderEvent.ts
        }
        order.updated = orderEvent.ts
        order.expires = orderEvent.expires
        if (orderEvent.action === 'removed') {
            if (orderEvent.amount > 0n) {
                order.status = Order.ORDER_STATUS.CANCELED
            } else {
                order.status = Order.ORDER_STATUS.FILLED
            }
        } else {
            order.status = Order.ORDER_STATUS.ACTIVE
        }
        return order
    }
}

/**
 * Reverse order kind mapping
 * @type {{}}
 */
const ORDER_KIND_MAP = {
    1: 'LIMIT'/*,
    'MARKET',
    'STOP_LOSS',
    'ICEBERG'*/
}

/**
 * Reverse order status mapping
 * @type {{}}
 */
const ORDER_STATUS_MAP = {
    0: 'ACTIVE',
    1: 'FILLED',
    2: 'CANCELED'
}

function serializeOrder(order) {
    const res = {
        id: order.id.toString(),
        status: ORDER_STATUS_MAP[order.status],
        kind: ORDER_KIND_MAP[order.kind],
        buying: order.buying,
        selling: order.selling,
        price: order.price.toString(),
        rprice: toRationalPrice(order.price),
        quote: order.quote.toString(),
        amount: order.amount.toString(),
        owner: order.owner
    }
    if (order.expires > 0){
        res.expires = formatDateUTC(order.expires)
    }
    if (order.iceberg > 0n) {
        res.iceberg = order.iceberg.toString()
    }
    if (order.stop > 0n) {
        res.stop = order.stop.toString()
    }
    if (order.created) {
        res.created = formatDateUTC(order.created)
    }
    if (order.updated) {
        res.updated = formatDateUTC(order.updated)
    }
    return res
}

module.exports = Order