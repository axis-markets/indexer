const AssetMarkets = require('./asset-markets')
const OrderbookMarketsList = require('./orderbook-markets-list')

class OrderBookGraphSide {
    /**
     * @param {TradeDirection} side
     */
    constructor(side) {
        this.side = side
        this.graphMap = new Map()
    }

    /**
     * @type {TradeDirection}
     * @readonly
     */
    side
    /**
     * @type {Map<string,AssetMarkets>}
     * @private
     */
    graphMap

    /**
     * @param {Order} order
     */
    addOrder(order) {
        this.getMarkets(order.selling).addOrder(order)
    }

    /**
     * @param {Order} order
     * @returns {boolean}
     */
    removeOrder(order) {
        const removed = this.getMarkets(order.selling).removeOrder(order)
            || this.getMarkets(order.buying).removeOrder(order)
        if (removed) {
            this.removeMarketsIfEmpty(order.selling)
            this.removeMarketsIfEmpty(order.buying)
        }
        return false
    }

    /**
     * @param {string} asset
     * @param {boolean} [autoCreate]
     * @returns {AssetMarkets}
     * @private
     */
    getMarkets(asset, autoCreate = true) {
        let edges = this.graphMap.get(asset)
        if (!edges && autoCreate) {
            edges = new AssetMarkets(asset, this.side)
            this.graphMap.set(asset, edges)
        }
        return edges
    }

    /**
     * @param {string} asset
     * @private
     */
    removeMarketsIfEmpty(asset) {
        const edgeSet = this.getMarkets(asset, false)
        if (edgeSet && !edgeSet.hasMarkets) {
            this.graphMap.delete(asset)
        }
    }

    /**
     * @return {OrderbookMarketsList}
     */
    getAllMarkets(){
        return new OrderbookMarketsList().loadFromMarkets(this.graphMap.values())
    }
}

/**
 * @typedef {'buying'|'selling'} TradeDirection
 */

/**
 * @typedef {{pair: string[], orders: number}} MarketInfo
 */

module.exports = OrderBookGraphSide