const Order = require('../entries/order')
const HistoryStorage = require('./history-storage')
const {toPair} = require('../utils/asset-pair')

class InMemoryHistoryStorage extends HistoryStorage {
    constructor() {
        super()
        this.trades = []
        this.orders = []
    }

    /**
     * @type {Trade[]}
     * @private
     */
    trades
    /**
     * @type {Order[]}
     * @private
     */
    orders
    /**
     * @type {string}
     * @private
     */
    cursor

    /**
     * @inheritDoc
     */
    storeTrade(trade) {
        this.trades.push(trade)
    }

    /**
     * @inheritDoc
     */
    storeOrder(order) {
        if (order.status === Order.ORDER_STATUS.ACTIVE)
            throw new Error('Attempt to archive active order ' + order.id)
        this.orders.push(order)
    }

    /**
     * Set event stream cursor and save changes
     * @param {String} cursor
     * @return {Promise<void>}
     */
    async save(cursor) {
        this.cursor = cursor
    }

    /**
     * Get event stream cursor
     * @return {Promise<string>}
     */
    async getCursor() {
        return this.cursor
    }

    /**
     * Load trades history
     * @param {{limit: number, [cursor]: string, [pair]: string, [trader]: string}} filter
     * @return {Promise<Trade[]>}
     */
    async getTrades(filter) {
        const res = []
        const {trades} = this
        for (let i = trades.length - 1; i >= 0; i--) {
            const trade = trades[i]
            if (filter.cursor && trade.id > filter.cursor)
                continue
            if (filter.trader && trade.taker !== filter.trader && trade.maker !== filter.trader)
                continue
            if (filter.pair && filter.pair !== toPair(trade.soldAsset, trade.boughtAsset))
                continue
            res.push(trade)
            if (res.length >= filter.limit)
                break
        }
        return res
    }

    /**
     * Load archived orders
     * @param {{limit: number, [owner]: string, [pair]: string[], [cursor]: string}} filter
     * @return {Promise<Order[]>}
     */
    async getOrders(filter) {
        const res = []
        const {orders} = this
        for (let i = orders.length - 1; i >= 0; i--) {
            const order = orders[i]
            if (filter.cursor && order.id > filter.cursor)
                continue
            if (filter.owner && order.owner !== filter.owner)
                continue
            if (filter.pair && filter.pair !== toPair(trade.soldAsset, trade.boughtAsset))
                continue
            res.push(order)
            if (res.length >= filter.limit)
                break
        }
        return res
    }

    /**
     * @return {Promise}
     * @virtual
     */
    async dispose() {
    }
}

module.exports = InMemoryHistoryStorage