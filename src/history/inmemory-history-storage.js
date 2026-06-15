const {toPair} = require('../utils/asset-pair')
const Order = require('../entries/order')
const HistoryStorage = require('./history-storage')

class InMemoryHistoryStorage extends HistoryStorage {
    constructor() {
        super()
        this.trades = []
        this.archivedOrders = []
        this.activeOrders = new Map()
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
    archivedOrders
    /**
     * @type {Map<bigint,Order>}
     * @private
     */
    activeOrders
    /**
     * @type {string}
     * @private
     */
    cursor

    /** @inheritDoc */
    async storeTrade(trade, cursor) {
        this.trades.push(trade)
        this.cursor = cursor
    }

    /** @inheritDoc */
    async storeOrder(order, cursor) {
        if (order.status === Order.ORDER_STATUS.ACTIVE){
            this.activeOrders.set(order.id, order)
        } else {
            this.activeOrders.delete(order.id)
            this.archivedOrders.push(order)
        }
        this.cursor = cursor
    }
    /*
    async save(cursor) {

        //await fs.writeFile(this.filePath, JSON.stringify(this.storage))
    }*/

    /** @inheritDoc */
    async getCursor() {
        return this.cursor
    }

    /** @inheritDoc */
    async loadTrades(filter) {
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

    /** @inheritDoc */
    async loadArchivedOrders(filter) {
        return filterOrders(this.archivedOrders, filter)
    }

    /** @inheritDoc */
    async loadActiveOrders(filter) {
        return filterOrders(this.activeOrders.values(), filter)
    }

    /** @inheritDoc */
    async dispose() {
    }
}

function filterOrders(orders, filter) {
    //accept both arrays and Map iterators (active orders are stored in a Map)
    const list = Array.isArray(orders) ? orders : [...orders]
    const res = []
    for (let i = list.length - 1; i >= 0; i--) {
        const order = list[i]
        if (filter.cursor && order.id > filter.cursor)
            continue
        if (filter.owner && order.owner !== filter.owner)
            continue
        if (filter.pair && filter.pair !== toPair(order.selling, order.buying))
            continue
        res.push(order)
        if (res.length >= filter.limit)
            break
    }
    return res
}

module.exports = InMemoryHistoryStorage