const {approximatePrice} = require('../utils/price')
const {formatDateUTC} = require('../utils/date')

/** On-chain multi-market swap event */
class Swap {
    /**
     * Unique swap ID (last trade id assigned while settling the swap legs)
     * @type {bigint}
     */
    id
    /**
     * Trader account address
     * @type {string}
     */
    trader
    /**
     * Sold token
     * @type {string}
     */
    soldAsset
    /**
     * Bought token
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
     * Swap date
     * @type {number}
     */
    ts

    toJSON() {
        return serializeSwap(this)
    }

    /**
     * @param {{}} swapEvent
     * @return {Swap}
     */
    static fromEvent(swapEvent) {
        const swap = new Swap()
        Object.assign(swap, swapEvent) //fields are identical, just create typed object
        return swap
    }
}

/**
 * Copies fields from a swap for serialization
 * @param {Swap} swap
 */
function serializeSwap(swap) {
    return {
        type: 'swap',
        id: swap.id.toString(),
        trader: swap.trader,
        soldAsset: swap.soldAsset,
        boughtAsset: swap.boughtAsset,
        sold: swap.sold.toString(),
        bought: swap.bought.toString(),
        price: approximatePrice(swap.bought, swap.sold),
        cursor: swap.cursor,
        timestamp: formatDateUTC(swap.ts)
    }
}

module.exports = Swap
