const {approximatePrice} = require('../utils/price')
const {formatDateUTC} = require('../utils/date')

/** On-chain multi-market swap event */
class Swap {
    /**
     * Record type discriminator
     * @type {'swap'}
     * @readonly
     */
    type = 'swap'
    /**
     * Unique swap ID (event position derived from ledger, transaction and event index)
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
     * Swap date
     * @type {number}
     */
    ts

    toJSON() {
        return serializeSwap(this)
    }

    /**
     * @param {SwapEvent} swapEvent
     * @return {Swap}
     */
    static fromEvent(swapEvent) {
        const swap = new Swap()
        swap.id = swapEvent.id ?? swapEvent.position
        swap.trader = swapEvent.trader
        swap.soldAsset = swapEvent.soldAsset
        swap.boughtAsset = swapEvent.boughtAsset
        swap.sold = swapEvent.sold
        swap.bought = swapEvent.bought
        swap.ledger = swapEvent.ledger
        swap.cursor = swapEvent.cursor
        swap.ts = swapEvent.ts
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
        cursor: swap.id.toString(),
        timestamp: formatDateUTC(swap.ts)
    }
}

module.exports = Swap
