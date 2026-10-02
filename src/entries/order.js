const {toRationalPrice} = require('../utils/price')
const {formatDateUTC} = require('../utils/date')

class Order {
    /**
     * Unique ID (u128 derived by the contract from the owner and a client nonce)
     * @type {bigint}
     */
    id
    /**
     * Current order status
     * @type {Order.ORDER_STATUS}
     */
    status
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
     * Order price (buying per 1 selling, 18 decimals)
     * @type {bigint}
     */
    price
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
     * Maker address
     * @type {string}
     */
    owner
    /**
     * Expiration timestamp, UNIX seconds (0 = no expiration)
     * @type {number}
     */
    expires = 0
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
     * Creation event ordinal, used for ordering and pagination (ids are hashes and may be reused)
     * @type {bigint}
     */
    position
    /**
     * Creation event data source cursor
     * @type {string}
     */
    cursor

    toString() {
        return `[${this.id}] ${this.buying}/${this.selling} price ${this.price} amount ${this.amount}`
    }

    /**
     * @param {BackingView} [backing] - Maker backing in the selling asset
     * @param {bigint} [backed] - Share of the maker budget allocated to the order (defaults to min(budget, amount))
     */
    toJSON(backing, backed) {
        return serializeOrder(this, backing, backed)
    }

    /**
     * Apply a fill: the contract reports the amount left after the trade
     * @param {bigint} left - Amount left after the fill
     * @param {number} ts - Fill timestamp
     */
    applyFill(left, ts) {
        this.amount = left
        this.updated = ts
        if (left <= 0n) {
            this.status = Order.ORDER_STATUS.FILLED
        }
    }

    /**
     * Apply a `mod` event: new price, amount and expiration (reviving an expired order), or removal when the amount
     * is zero (a removal keeps the last amount, price and expiration)
     * @param {bigint} price - New price
     * @param {bigint} amount - New amount (0 = removed by the owner)
     * @param {number} expires - New expiration timestamp, UNIX seconds (0 = no expiration)
     * @param {number} ts - Event timestamp
     */
    applyMod(price, amount, expires, ts) {
        this.updated = ts
        if (amount <= 0n) {
            this.status = Order.ORDER_STATUS.CANCELED
            return
        }
        this.status = Order.ORDER_STATUS.ACTIVE
        this.price = price
        this.amount = amount
        this.expires = expires || 0
    }

    /**
     * Mark the order expired (the contract emits nothing when an order expires). The order is archived, though its
     * entry stays on-chain: the owner may still remove or revive it, and a new order may take its id
     */
    applyExpiration() {
        this.status = Order.ORDER_STATUS.EXPIRED
        if (this.expires > 0) {
            this.updated = this.expires
        }
    }

    /**
     * Whether the order has expired: the contract no longer fills it, but keeps its entry until the owner removes or
     * revives it, or a new order reuses the id
     * @param {number} now - Current timestamp, UNIX seconds
     * @return {boolean}
     */
    isExpired(now) {
        return this.expires > 0 && this.expires <= now
    }

    static ORDER_STATUS = {
        ACTIVE: 0,
        FILLED: 1,
        CANCELED: 2,
        EXPIRED: 3
    }

    /**
     * Build an active order from the `new` contract event
     * @param {OrderEvent} orderEvent
     * @return {Order}
     */
    static fromCreatedEvent(orderEvent) {
        const order = new Order()
        order.id = orderEvent.id
        order.buying = orderEvent.buying
        order.selling = orderEvent.selling
        order.amount = orderEvent.amount
        order.quote = orderEvent.amount
        order.price = orderEvent.price
        order.owner = orderEvent.owner
        order.expires = orderEvent.expires || 0
        order.status = Order.ORDER_STATUS.ACTIVE
        order.created = orderEvent.ts
        order.updated = orderEvent.ts
        order.position = orderEvent.position
        order.cursor = orderEvent.cursor
        return order
    }
}

/**
 * Reverse order status mapping
 * @type {{}}
 */
const ORDER_STATUS_MAP = {
    0: 'ACTIVE',
    1: 'FILLED',
    2: 'CANCELED',
    3: 'EXPIRED'
}

/**
 * @param {Order} order
 * @param {BackingView} [backing]
 * @param {bigint} [backed]
 */
function serializeOrder(order, backing, backed) {
    const res = {
        id: order.id.toString(),
        status: ORDER_STATUS_MAP[order.status],
        buying: order.buying,
        selling: order.selling,
        price: order.price.toString(),
        rprice: toRationalPrice(order.price),
        quote: order.quote.toString(),
        amount: order.amount.toString(),
        owner: order.owner
    }
    if (backing) {
        if (backed === undefined) {
            backed = backing.budget < order.amount ? backing.budget : order.amount
        }
        res.backed = (backed < 0n ? 0n : backed).toString()
        res.backing = {
            balance: backing.balance.toString(),
            allowance: backing.allowance.toString(),
            liveUntil: backing.liveUntil,
            authorized: backing.authorized
        }
        if (backing.updated) {
            res.backing.updated = formatDateUTC(backing.updated)
        }
        if (backing.pending) {
            res.backing.pending = true
        }
    }
    if (order.expires > 0) {
        res.expires = formatDateUTC(order.expires)
    }
    if (order.created) {
        res.created = formatDateUTC(order.created)
    }
    if (order.updated) {
        res.updated = formatDateUTC(order.updated)
    }
    if (order.position !== undefined) {
        res.cursor = order.position.toString()
    }
    return res
}

module.exports = Order

/**
 * Backing record with the effective budget computed for the current ledger
 * @typedef {BackingRecord} BackingView
 * @property {bigint} budget - min(balance, allowance), zero when the allowance expired
 * @property {number} updated - Last refresh timestamp, UNIX milliseconds
 * @property {number} [skipped] - Last `skip` event of an order of the maker selling the asset, UNIX seconds (0 = none)
 * @property {boolean} [pending] - A recheck confirming the latest event is still due
 */
