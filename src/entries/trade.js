const {approximatePrice} = require('../utils/price')

class Trade {
    /**
     * Unique trade id
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
     * Transaction hash
     * @type {string}
     */
    txHash
    /**
     * Trade date
     * @type {Date}
     */
    ts

    /**
     * Returns a trade in the serialization-ready format
     */
    toJSON() {
        const price = ''
        const res = {
            id: this.id.toString(),
            order: this.order.toString(),
            taker: this.taker,
            maker: this.maker,
            soldAsset: this.soldAsset,
            boughtAsset: this.boughtAsset,
            sold: this.sold.toString(),
            bought: this.bought.toString(),
            price: approximatePrice(this.bought, this.sold),
            txHash: this.txHash,
            timestamp: new Date(this.ts).toISOString()
        }
        return res
    }
}

module.exports = Trade