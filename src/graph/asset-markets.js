/**
 * Maintains a mapping of assets to order vectors
 */
class AssetMarkets {
    /**
     * @param {string} buyingAsset - Buying asset for this markets group
     * @param {TradeDirection} type - Buying/selling
     */
    constructor(buyingAsset, type) {
        this.buyingAsset = buyingAsset
        this.type = type
        this.markets = new Map()
    }

    /**
     * @type {string}
     * @readonly
     */
    buyingAsset
    /**
     * @type {TradeDirection}
     * @readonly
     */
    type
    /**
     * @type {Map<string,Order[]>}
     * @private
     */
    markets

    get counterAssets(){
        return this.markets.keys()
    }

    get size() {
        return this.markets.size
    }

    get hasMarkets() {
        return !!this.markets.size
    }

    /**
     * @return {IterableIterator<[string, Order[]]>}
     */
    entries() {
        return this.markets.entries()
    }

    /**
     * Load order vector
     * @param {string} counterAsset - An asset to trade with
     * @param {boolean} [autoCreate] - Whether the vector container should be auto-created
     * @return {Order[]}
     */
    get(counterAsset, autoCreate = false) {
        let orderVector = this.markets.get(counterAsset)
        if (!orderVector && autoCreate) {
            orderVector = []
            this.markets.set(counterAsset, orderVector)
        }
        return orderVector
    }

    /**
     * Insert the given order into the order set (an array sorted by cheapest to most expensive price to convert buyingAsset to sellingAsset)
     * @param {Order} newOrder - Order to add
     */
    addOrder(newOrder) { //TODO: consider double-linked list instead  - O(1) inserts and deletes, access pattern is always sequential
        const otherAsset = this.getCounterAsset(newOrder)
        //find orders vector
        const orders = this.get(otherAsset, true)

        if (orders.length) {
            //TODO: try to utilize some kind of binary search to optimize insertion speed (low priority)
            //walk through orders to find the index to insert
            for (let i = 0; i < orders.length; i++) {
                //iterate until we find an item with better/worse price than new order price (depending on order type), and insert before it
                const existing = orders[i]
                const shouldInsert = this.type === 'buying' ?
                    existing.price < newOrder.price :
                    existing.price > newOrder.price
                if (shouldInsert) {
                    orders.splice(i, 0, newOrder)
                    return
                }
            }
        }
        //add to the end
        orders.push(newOrder)
    }

    /**
     * Delete the given order from the set
     * @param {Order} order - Order to remove
     * @return {boolean}
     */
    removeOrder(order) {
        const otherAsset = this.getCounterAsset(order)
        //find orders vector
        const orders = this.get(otherAsset)
        if (!orders)
            return false //corresponding asset>orders not found - state is corrupted, something gone wrong
        const orderPosition = orders.indexOf(order)
        if (orderPosition < 0)
            return false //order not found - state is corrupted
        //remove individual order
        orders.splice(orderPosition, 1)
        if (!orders.length) { //remove orders vector if it contains no other orders
            this.markets.delete(otherAsset)
        }
        return true
    }

    /**
     * @param {Order} entry
     * @return {string}
     * @private
     */
    getCounterAsset(entry) {
        return entry.selling === this.buyingAsset ? entry.buying : entry.selling
    }
}

module.exports = AssetMarkets