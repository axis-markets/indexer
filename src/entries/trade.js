const {approximatePrice} = require('../utils/price')
const {formatDateUTC} = require('../utils/date')

/** On-chain trade event (one per fill) */
class Trade {
    /**
     * Record type discriminator
     * @type {'trade'}
     * @readonly
     */
    type = 'trade'
    /**
     * Unique trade ID (event position derived from ledger, transaction and event index)
     * @type {bigint}
     */
    id
    /**
     * Maker order id
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
     * Token sold by the taker
     * @type {string}
     */
    soldAsset
    /**
     * Token bought by the taker
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
     * Maker order amount left after the fill (0 = removed)
     * @type {bigint}
     */
    left
    /**
     * Ledger sequence
     * @type {number}
     */
    ledger
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
     * @param {TradeEvent} tradeEvent
     * @return {Trade}
     */
    static fromEvent(tradeEvent) {
        const trade = new Trade()
        trade.id = tradeEvent.id ?? tradeEvent.position
        trade.order = tradeEvent.order
        trade.taker = tradeEvent.taker
        trade.maker = tradeEvent.maker
        trade.soldAsset = tradeEvent.soldAsset
        trade.boughtAsset = tradeEvent.boughtAsset
        trade.sold = tradeEvent.sold
        trade.bought = tradeEvent.bought
        trade.left = tradeEvent.left
        trade.ledger = tradeEvent.ledger
        trade.cursor = tradeEvent.cursor
        trade.ts = tradeEvent.ts
        return trade
    }
}

/**
 * Copies fields from a trade for serialization
 * @param {Trade} trade
 */
function serializeTrade(trade) {
    const res = {
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
        cursor: trade.id.toString(),
        timestamp: formatDateUTC(trade.ts)
    }
    if (trade.left !== undefined) {
        res.left = trade.left.toString()
    }
    return res
}

module.exports = Trade
