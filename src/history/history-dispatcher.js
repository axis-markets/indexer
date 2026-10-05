const {StrKey} = require('@stellar/stellar-sdk')
const {normalizeLimit, isValidActor, parseIdCursor} = require('../utils/validation')
const {toPair} = require('../utils/asset-pair')
const stdErrors = require('../server/errors')

class HistoryDispatcher {
    /**
     * @param {HistoryStorage} historyStorage
     */
    constructor(historyStorage) {
        this.historyStorage = historyStorage
    }

    /**
     * @readonly
     * @type {HistoryStorage}
     */
    historyStorage

    /**
     * Load archived orders, newest first
     * @param {{limit: number, [owner]: string, [pair]: string[], [cursor]: string}} filter - Query filters; `cursor` is the cursor of the last order received (exclusive) - Query filters;  is the cursor of the last order received
     * @return {Promise<Order[]>}
     */
    async loadOrdersHistory(filter = {}) {
        const params = {}
        if (filter.owner) {
            if (!isValidActor(filter.owner))
                throw stdErrors.validationError('owner')
            params.owner = filter.owner
        }
        if (filter.pair) {
            const [a, b] = validatePair(filter.pair)
            params.pair = toPair(a, b)
        }
        if (filter.cursor) {
            params.cursor = parseIdCursor(filter.cursor)
        }
        params.limit = normalizeLimit(filter.limit, 20, 500)
        const data = await this.historyStorage.loadArchivedOrders(params)
        return data.map(order => order.toJSON())
    }

    /**
     * Load trades history, newest first
     * @param {{limit: number, [cursor]: string, [pair]: string[], [trader]: string}} filter - Query filters; `cursor` is the id of the last trade received (exclusive)
     * @return {Promise<Trade[]>}
     */
    async loadTradesHistory(filter) {
        const params = {}
        if (filter.trader) {
            if (!isValidActor(filter.trader))
                throw stdErrors.validationError('trader')
            params.trader = filter.trader
        }
        if (filter.pair) {
            const [a, b] = validatePair(filter.pair)
            params.pair = toPair(a, b)
        }
        if (filter.cursor) {
            params.cursor = parseIdCursor(filter.cursor)
        }
        params.limit = normalizeLimit(filter.limit, 20, 500)
        const data = await this.historyStorage.loadTrades(params)
        return data.map(trade => trade.toJSON())
    }

    /**
     * Load failed AXIS transactions, newest first
     * @param {{limit: number, [cursor]: string, [account]: string, [fn]: string}} filter - Query filters; `account`
     *   matches the caller and the parties of the failed transfer; `cursor` is the id of the last record received (exclusive)
     * @return {Promise<{}[]>}
     */
    async loadFailures(filter) {
        const params = {}
        if (filter.account) {
            if (!isValidActor(filter.account))
                throw stdErrors.validationError('account')
            params.account = filter.account
        }
        if (filter.fn) {
            if (typeof filter.fn !== 'string' || !/^[a-z_]{1,32}$/.test(filter.fn))
                throw stdErrors.validationError('fn')
            params.fn = filter.fn
        }
        if (filter.cursor) {
            params.cursor = parseIdCursor(filter.cursor)
        }
        params.limit = normalizeLimit(filter.limit, 20, 500)
        const data = await this.historyStorage.loadFailures(params)
        return data.map(failure => failure.toJSON())
    }
}

function validatePair(pair) {
    if (!(pair instanceof Array) || pair.length !== 2 || pair.some(v => !StrKey.isValidContract(v)))
        throw stdErrors.validationError('pair')
    return pair
}

module.exports = HistoryDispatcher