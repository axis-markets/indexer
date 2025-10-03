const OrderBookGraphSide = require('./orderbook-graph-side')
const OrderbookMarketsList = require('./orderbook-markets-list')

/**
 * OrderBookGraph is an in-memory graph representation of all the orders in the ledger
 */
class OrderBookGraph {
    constructor() {
        this.init()
    }

    /**
     * @type {OrderBookGraphSide}
     * @private
     */
    sellingGraph
    /**
     * @type {OrderBookGraphSide}
     * @private
     */
    buyingGraph
    /**
     * @type {Map<bigint, Order>}
     * @readonly
     */
    allOrders
    /**
     * Last update ledger sequence
     * @type {number}
     * @readonly
     */
    lastLedger = 0

    /**
     * Returns true if the graph has no orders
     * @return {boolean}
     */
    get isEmpty() {
        return !this.allOrders.size
    }

    /**
     * Inserts a given order into the order book graph
     * @param {Order} order
     */
    addOrder(order) {
        //check if the order already exists in the graph
        const existingOrder = this.allOrders.get(order.id)
        if (existingOrder) {
            if (existingOrder.selling === order.selling && existingOrder.buying === order.buying && existingOrder.price === order.price) {
                //only amount changed - update an order in place
                existingOrder.amount = order.amount
                return
            }
            //assets or price changed - need to remove the order from edges and re-add it afterward
            this.removeOrder(order.id)
        }
        this.allOrders.set(order.id, order)
        //add to graph
        this.buyingGraph.addOrder(order)
        this.sellingGraph.addOrder(order)
    }

    /**
     * Delete a given order from the order book graph
     * @param {bigint} orderId
     * @return {boolean}
     */
    removeOrder(orderId) {
        const order = this.allOrders.get(orderId)
        if (!order) return false
        this.allOrders.delete(orderId)

        if (!this.buyingGraph.removeOrder(order) || !this.sellingGraph.removeOrder(order))
            throw new Error('Order not present in the graph ' + orderId.toString())
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
        this.lastLedger = 0
    }
}

module.exports = OrderBookGraph