const AssetMarkets = require('./asset-market')
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
     * @readonly
     */
    graphMap

    /**
     * @param {Order} order
     */
    addOrder(order) {
        this.getMarkets(this.getIndexAsset(order)).addOrder(order)
    }

    /**
     * @param {Order} order
     * @returns {boolean}
     */
    removeOrder(order) {
        const key = this.getIndexAsset(order)
        const markets = this.getMarkets(key, false)
        if (!markets)
            return true
        const removed = markets.removeOrder(order)
        if (removed) {
            this.removeMarketsIfEmpty(key)
        }
        return removed
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
     * Markets for orders indexed under the given asset, or undefined
     * @param {string} asset
     * @return {AssetMarkets|undefined}
     */
    get(asset) {
        return this.graphMap.get(asset)
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


    /**
     * Asset under which an order is indexed on this side orderbook side
     * @param {Order} order
     * @return {string}
     * @private
     */
    getIndexAsset(order) {
        return this.side === 'selling' ? order.buying : order.selling
    }
}

/**
 * @typedef {'buying'|'selling'} TradeDirection
 */

/**
 * @typedef {{pair: string[], orders: number}} MarketInfo
 */

module.exports = OrderBookGraphSide