const {toPair} = require('../utils/asset-pair')
const Order = require('../entries/order')
const Failure = require('../entries/failure')
const parseHistoryEntry = require('../entries/parse-history-entry')
const HistoryStorage = require('./history-storage')

class InMemoryHistoryStorage extends HistoryStorage {
    constructor() {
        super()
        this.trades = []
        this.failures = []
        this.archivedOrders = []
        this.activeOrders = []
        this.activeById = new Map()
    }

    /**
     * Trades and swaps sorted by id, ascending
     * @type {(Trade|Swap)[]}
     * @private
     */
    trades
    /**
     * Failed AXIS transactions sorted by id, ascending
     * @type {Failure[]}
     * @private
     */
    failures
    /**
     * Finalized orders sorted by `(position, id)`, ascending (the same id may appear several times - ids are reusable)
     * @type {Order[]}
     * @private
     */
    archivedOrders
    /**
     * Active orders sorted by `(position, id)`, ascending
     * @type {Order[]}
     * @private
     */
    activeOrders
    /**
     * Active orders by id
     * @type {Map<bigint,Order>}
     * @private
     */
    activeById
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
        const {trades} = this
        const index = lowerBound(trades, record => compareBigInt(record.id, trade.id))
        //a replayed trade is stored once, the first record is kept
        if (index === trades.length || compareBigInt(trades[index].id, trade.id) !== 0) {
            trades.splice(index, 0, trade)
        }
        this.cursor = cursor
    }

    /** @inheritDoc */
    async storeFailure(failure) {
        const {failures} = this
        const index = lowerBound(failures, record => compareBigInt(record.id, failure.id))
        if (index === failures.length || compareBigInt(failures[index].id, failure.id) !== 0) {
            failures.splice(index, 0, failure)
        }
    }

    /** @inheritDoc */
    async loadFailures(filter) {
        const {failures} = this
        const limit = filter.limit ?? Infinity
        const res = []
        let i = filter.cursor ? lowerBound(failures, failure => compareBigInt(failure.id, filter.cursor)) : failures.length
        while (--i >= 0 && res.length < limit) {
            const failure = failures[i]
            if (filter.account && !failure.involves(filter.account))
                continue
            if (filter.fn && failure.fn !== filter.fn)
                continue
            res.push(Failure.fromEvent(failure))
        }
        return res
    }

    /** @inheritDoc */
    async storeOrder(order, cursor) {
        //records are upserted by (id, position): a revived expired order moves back to the active set
        removeRecord(this.archivedOrders, order)
        const active = this.activeById.get(order.id)
        if (order.status === Order.ORDER_STATUS.ACTIVE) {
            if (active) {
                removeRecord(this.activeOrders, active)
            }
            this.activeById.set(order.id, order)
            insertRecord(this.activeOrders, order)
        } else {
            //ids are reusable - evict the active record only if it is the same order (same creation position)
            if (active && compareBigInt(active.position, order.position) === 0) {
                this.activeById.delete(order.id)
                removeRecord(this.activeOrders, active)
            }
            insertRecord(this.archivedOrders, order)
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
        const {trades} = this
        const limit = filter.limit ?? Infinity
        const res = []
        let i = filter.cursor ? lowerBound(trades, trade => compareBigInt(trade.id, filter.cursor)) : trades.length
        while (--i >= 0 && res.length < limit) {
            const trade = trades[i]
            //swaps expose `trader`; trades expose `taker`/`maker`
            if (filter.trader && trade.taker !== filter.trader && trade.maker !== filter.trader && trade.trader !== filter.trader)
                continue
            if (filter.pair && filter.pair !== toPair(trade.soldAsset, trade.boughtAsset))
                continue
            //reconstruct the typed entry (Trade or Swap) from the persisted record's type
            res.push(parseHistoryEntry(trade))
        }
        return res
    }

    /** @inheritDoc */
    async loadArchivedOrders(filter) {
        return filterOrders(this.archivedOrders, filter)
    }

    /** @inheritDoc */
    async loadActiveOrders(filter) {
        return filterOrders(this.activeOrders, filter)
    }

    /** @inheritDoc */
    async dispose() {
    }
}

/**
 * Newest-first scan with the exclusive `position` cursor
 * @param {Order[]} orders - Sorted by `(position, id)`, ascending
 * @param {{limit: number, [owner]: string, [pair]: string, [status]: number, [cursor]: bigint}} filter
 * @return {Order[]}
 */
function filterOrders(orders, filter) {
    const limit = filter.limit ?? Infinity
    const res = []
    let i = filter.cursor ? lowerBound(orders, order => compareBigInt(order.position, filter.cursor)) : orders.length
    while (--i >= 0 && res.length < limit) {
        const order = orders[i]
        if (filter.owner && order.owner !== filter.owner)
            continue
        if (filter.status !== undefined && order.status !== filter.status)
            continue
        if (filter.pair && filter.pair !== toPair(order.selling, order.buying))
            continue
        res.push(order)
    }
    return res
}

/**
 * Insert an order record into a sorted list, replacing the record with the same `(id, position)`
 * @param {Order[]} list - Sorted by `(position, id)`, ascending
 * @param {Order} order
 */
function insertRecord(list, order) {
    const index = lowerBound(list, record => compareRecords(record, order))
    if (index < list.length && compareRecords(list[index], order) === 0) {
        list[index] = order
    } else {
        list.splice(index, 0, order)
    }
}

/**
 * Remove the order record with the same `(id, position)` from a sorted list, if any
 * @param {Order[]} list - Sorted by `(position, id)`, ascending
 * @param {Order} order
 */
function removeRecord(list, order) {
    const index = lowerBound(list, record => compareRecords(record, order))
    if (index < list.length && compareRecords(list[index], order) === 0) {
        list.splice(index, 1)
    }
}

/**
 * Index of the first element of a sorted list that does not precede the target
 * @param {Array} list - Sorted ascending
 * @param {function(*): number} compareToTarget - Negative when the element precedes the target
 * @return {number}
 */
function lowerBound(list, compareToTarget) {
    let low = 0
    let high = list.length
    while (low < high) {
        const middle = (low + high) >>> 1
        if (compareToTarget(list[middle]) < 0) {
            low = middle + 1
        } else {
            high = middle
        }
    }
    return low
}

/**
 * Order records by creation position, then id (the storage order key)
 * @param {Order} a
 * @param {Order} b
 * @return {number}
 */
function compareRecords(a, b) {
    return compareBigInt(a.position, b.position) || compareBigInt(a.id, b.id)
}

/**
 * Compare integers of any size (positions and ids may exceed int64)
 * @param {bigint|string|number} a
 * @param {bigint|string|number} b
 * @return {number}
 */
function compareBigInt(a, b) {
    a = BigInt(a)
    b = BigInt(b)
    return a < b ? -1 : a > b ? 1 : 0
}

module.exports = InMemoryHistoryStorage
