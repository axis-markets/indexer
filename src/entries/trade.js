const {approximatePrice} = require('../utils/price')
const {formatDateUTC} = require('../utils/date')

/** On-chain trade event */
class Trade {
    /**
     * Unique trade ID
     * @type {bigint}
     */
    id
    /**
     * Order id
     * @type {bigint}
     */
    order
    /**
     * Trader account address
     * @type {string}
     */
    taker
    /**
     * Seller account address
     * @type {string}
     */
    maker
    /**
     * Selling token
     * @type {string}
     */
    soldAsset
    /**
     * Buying token
     * @type {string}
     */
    boughtAsset
    /**
     * Sold tokens amount
     * @type {bigint}
     */
    sold
    /**
     * Bought tokens amount
     * @type {bigint}
     */
    bought
    /**
     * Data pagination cursor
     * @type {string}
     */
    cursor
    /**
     * Trade date
     * @type {number}
     */
    ts

    toJSON() {
        return serializeTrade(this)
    }

    /**
     * @param {{}} tradeEvent
     * @return {Trade}
     */
    static fromEvent(tradeEvent) {
        const trade = new Trade()
        Object.assign(trade, tradeEvent) //fields are identical, just create typed object
        return trade
    }
}

/**
 * Copies fields from a trade for serialization
 * @param {Trade} trade
 */
function serializeTrade(trade) {
    return {
        type: 'trade',
        id: trade.id.toString(),
        order: trade.order.toString(),
        taker: trade.taker,
        maker: trade.maker,
        soldAsset: trade.soldAsset,
        boughtAsset: trade.boughtAsset,
        sold: trade.sold.toString(),
        bought: trade.bought.toString(),
        price: approximatePrice(trade.bought, trade.sold),
        cursor: trade.cursor,
        timestamp: formatDateUTC(trade.ts)
    }
}

module.exports = Trade