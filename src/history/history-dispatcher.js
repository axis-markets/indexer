const {normalizeLimit, isValidActor, parseIdCursor} = require('../utils/validation')
const stdErrors = require('../server/errors')
const {StrKey} = require('@stellar/stellar-base')

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
     * Load archived orders
     * @param {{limit: number, [owner]: string, [pair]: string[], [cursor]: string}} filter
     * @return {Promise<Order[]>}
     */
    async getOrders(filter = {}) {
        const params = {}
        if (filter.owner) {
            if (!isValidActor(filter.owner))
                throw stdErrors.validationError('owner')
            params.owner = filter.owner
        }
        if (filter.pair) {
            params.pair = validatePair(filter.pair)
        }
        if (filter.cursor) {
            params.cursor = parseIdCursor(filter.cursor)
        }
        params.limit = normalizeLimit(filter.limit, 20, 500)
        const data = await this.historyStorage.getOrders(params)
        return data.map(order => {
            const serialized = order.toJSON()
            serialized.cursor = serialized.id
            return serialized
        })
    }

    /**
     * Load trades history
     * @param {{limit: number, [cursor]: string, [pair]: string[], [trader]: string}} filter
     * @return {Promise<Trade[]>}
     */
    async getTrades(filter) {
        const params = {}
        if (filter.trader) {
            if (!isValidActor(filter.trader))
                throw stdErrors.validationError('trader')
            params.trader = filter.trader
        }
        if (filter.pair) {
            params.pair = validatePair(filter.pair)
        }
        if (filter.cursor) {
            params.cursor = parseIdCursor(filter.cursor)
        }
        params.limit = normalizeLimit(filter.limit, 20, 500)
        const data = await this.historyStorage.getTrades(params)
        return data.map(order => {
            const serialized = order.toJSON()
            serialized.cursor = serialized.id
            return serialized
        })
    }
}

function validatePair(pair) {
    if (!(pair instanceof Array) || pair.length !== 2 || pair.some(v => !StrKey.isValidContract(v)))
        throw stdErrors.validationError('pair')
    return pair
}

module.exports = HistoryDispatcher