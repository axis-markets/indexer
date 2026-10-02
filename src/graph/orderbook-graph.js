const OrderBookGraphSide = require('./orderbook-graph-side')
const BackingTracker = require('./backing-tracker')

/**
 * OrderBookGraph is an in-memory graph representation of all the orders in the ledger
 */
class OrderBookGraph {
    /**
     * @param {BackingTracker} [backing] - Maker backing tracker (an inert tracker when omitted)
     */
    constructor(backing) {
        this.backing = backing || new BackingTracker()
        this.init()
    }

    /**
     * Maker balance/allowance tracker
     * @type {BackingTracker}
     * @readonly
     */
    backing

    /**
     * @type {OrderBookGraphSide}
     * @readonly
     */
    sellingGraph
    /**
     * @type {OrderBookGraphSide}
     * @readonly
     */
    buyingGraph
    /**
     * Every order stored on-chain, live or expired (expired ones are archived but can still be revived or removed)
     * @type {Map<bigint, Order>}
     * @readonly
     */
    allOrders
    /**
     * Orders of `allOrders` by owner address, in insertion (creation) order
     * @type {Map<string, Set<Order>>}
     * @readonly
     */
    ordersByOwner
    /**
     * Ids of expired orders, kept in `allOrders` but out of the market vectors
     * @type {Set<bigint>}
     * @readonly
     */
    expired
    /**
     * Last update ledger sequence
     * @type {number}
     * @readonly
     */
    lastLedger = 0

    /**
     * Returns true if the graph has no live orders
     * @return {boolean}
     */
    get isEmpty() {
        return this.allOrders.size === this.expired.size
    }

    /**
     * Load order from the graph
     * @param {bigint} orderId
     * @return {Order}
     */
    getOrder(orderId) {
        return this.allOrders.get(orderId)
    }

    /**
     * Live orders of the owner in creation order
     * @param {string} owner - Owner address
     * @return {Order[]}
     */
    getOwnerOrders(owner) {
        const owned = this.ordersByOwner.get(owner)
        if (!owned)
            return []
        const res = []
        for (const order of owned) {
            if (!this.expired.has(order.id)) {
                res.push(order)
            }
        }
        return res.sort((x, y) => (x.position < y.position ? -1 : x.position > y.position ? 1 : 0))
    }

    /**
     * Whether the order is live: known to the graph and listed in the price-sorted market vectors.
     * An expired order stays in `allOrders` (the contract keeps its entry) but is taken out of the vectors
     * @param {bigint} orderId
     * @return {boolean}
     */
    isLive(orderId) {
        return this.allOrders.has(orderId) && !this.expired.has(orderId)
    }

    /**
     * Inserts a given order into the order book graph, replacing any order stored under the same id
     * (ids are reusable once an order is gone or has expired)
     * @param {Order} order
     * @return {Order|undefined} - Replaced order, if any
     */
    addOrder(order) {
        const existingOrder = this.allOrders.get(order.id)
        if (existingOrder === order)
            return undefined
        if (existingOrder) {
            this.removeOrder(order.id)
        }
        this.allOrders.set(order.id, order)
        let owned = this.ordersByOwner.get(order.owner)
        if (!owned) {
            owned = new Set()
            this.ordersByOwner.set(order.owner, owned)
        }
        owned.add(order)
        this.attachOrder(order)
        return existingOrder
    }

    /**
     * Delete a given order from the order book graph
     * @param {bigint} orderId
     * @return {boolean}
     */
    removeOrder(orderId) {
        const order = this.allOrders.get(orderId)
        if (!order) return false
        this.detachOrder(order)
        this.allOrders.delete(orderId)
        const owned = this.ordersByOwner.get(order.owner)
        if (owned) {
            owned.delete(order)
            if (!owned.size) {
                this.ordersByOwner.delete(order.owner)
            }
        }
        return true
    }

    /**
     * Put a known order into the market vectors at its current price (a live order after a change or a revival)
     * @param {Order} order
     */
    attachOrder(order) {
        this.expired.delete(order.id)
        this.buyingGraph.addOrder(order)
        this.sellingGraph.addOrder(order)
    }

    /**
     * Take a known order out of the market vectors (before a price change, or once it expired)
     * @param {Order} order
     * @return {boolean} - Whether the order was live
     */
    detachOrder(order) {
        if (this.expired.delete(order.id))
            return false //already out of the vectors
        if (!this.buyingGraph.removeOrder(order) || !this.sellingGraph.removeOrder(order))
            throw new Error('Order not present in the graph ' + order.id.toString())
        return true
    }

    /**
     * Take the orders that have expired by `now` out of the market vectors; they stay in `allOrders`
     * @param {number} now - Current timestamp, UNIX seconds
     * @return {Order[]} - Orders that expired since the previous check
     */
    expireOrders(now) {
        const res = []
        for (const order of this.allOrders.values()) {
            if (order.isExpired(now) && this.expireOrder(order)) {
                res.push(order)
            }
        }
        return res
    }

    /**
     * Take an expired order out of the market vectors; it stays in `allOrders`
     * @param {Order} order
     * @return {boolean} - Whether the order was live
     */
    expireOrder(order) {
        if (this.expired.has(order.id))
            return false
        this.detachOrder(order)
        this.expired.add(order.id)
        return true
    }

    /**
     * @param {number} ledger
     */
    updateLastLedger(ledger) {
        /*if (ledger !== this.lastLedger + 1)
            throw new Error(`Invalid ledger update: ${ledger} ledger, expected ledger ${this.lastLedger + 1}`)*/
        this.lastLedger = ledger
    }

    /**
     * Recreate the graph
     */
    init() {
        this.sellingGraph = new OrderBookGraphSide('selling')
        this.buyingGraph = new OrderBookGraphSide('buying')
        this.allOrders = new Map()
        this.ordersByOwner = new Map()
        this.expired = new Set()
        this.lastLedger = 0
    }
}

module.exports = OrderBookGraph