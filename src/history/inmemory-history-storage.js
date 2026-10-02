const {toPair} = require('../utils/asset-pair')
const Order = require('../entries/order')
const parseHistoryEntry = require('../entries/parse-history-entry')
const HistoryStorage = require('./history-storage')

class InMemoryHistoryStorage extends HistoryStorage {
    constructor() {
        super()
        this.trades = []
        this.archivedOrders = new Map()
        this.activeOrders = new Map()
    }

    /**
     * @type {(Trade|Swap)[]}
     * @private
     */
    trades
    /**
     * Finalized orders in archival order keyed by `id:position` (the same id may appear several times - ids are
     * reusable)
     * @type {Map<string,Order>}
     * @private
     */
    archivedOrders
    /**
     * @type {Map<bigint,Order>}
     * @private
     */
    activeOrders
    /**
     * @type {{frozen: boolean, config?: ContractConfig, markets: ContractMarket[]}|undefined}
     * @private
     */
    contractState
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
        //records are upserted by (id, position): a revived expired order moves back to the active set
        const key = recordKey(order)
        this.archivedOrders.delete(key)
        if (order.status === Order.ORDER_STATUS.ACTIVE) {
            this.activeOrders.set(order.id, order)
        } else {
            //ids are reusable - evict the active record only if it is the same order (same creation position)
            const active = this.activeOrders.get(order.id)
            if (active && (active === order || active.position === order.position)) {
                this.activeOrders.delete(order.id)
            }
            this.archivedOrders.set(key, order)
        }
        this.cursor = cursor
    }

    /** @inheritDoc */
    async storeContractState(state, cursor) {
        this.contractState = state
        this.cursor = cursor
    }

    /** @inheritDoc */
    async loadContractState() {
        return this.contractState
    }

    /** @inheritDoc */
    async storeCursor(cursor) {
        this.cursor = cursor
    }

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
            if (filter.cursor && trade.id >= filter.cursor)
                continue
            //swaps expose `trader`; trades expose `taker`/`maker`
            if (filter.trader && trade.taker !== filter.trader && trade.maker !== filter.trader && trade.trader !== filter.trader)
                continue
            if (filter.pair && filter.pair !== toPair(trade.soldAsset, trade.boughtAsset))
                continue
            //reconstruct the typed entry (Trade or Swap) from the persisted record's type
            res.push(parseHistoryEntry(trade))
            if (res.length >= filter.limit)
                break
        }
        return res
    }

    /** @inheritDoc */
    async loadArchivedOrders(filter) {
        return filterOrders(this.archivedOrders.values(), filter)
    }

    /** @inheritDoc */
    async loadActiveOrders(filter) {
        return filterOrders(this.activeOrders.values(), filter)
    }

    /** @inheritDoc */
    async dispose() {
    }
}

/**
 * Newest-first scan with the exclusive `position` cursor
 * @param {Order[]|Iterator<Order>} orders
 * @param {{limit: number, [owner]: string, [pair]: string, [status]: number, [cursor]: bigint}} filter
 * @return {Order[]}
 */
function filterOrders(orders, filter) {
    //accept both arrays and Map iterators (active orders are stored in a Map)
    const list = Array.isArray(orders) ? orders : [...orders]
    const res = []
    for (let i = list.length - 1; i >= 0; i--) {
        const order = list[i]
        if (filter.cursor && order.position >= filter.cursor)
            continue
        if (filter.owner && order.owner !== filter.owner)
            continue
        if (filter.status !== undefined && order.status !== filter.status)
            continue
        if (filter.pair && filter.pair !== toPair(order.selling, order.buying))
            continue
        res.push(order)
        if (res.length >= filter.limit)
            break
    }
    return res
}

/**
 * @param {Order} order
 * @return {string}
 */
function recordKey(order) {
    return order.id + ':' + order.position
}

module.exports = InMemoryHistoryStorage
