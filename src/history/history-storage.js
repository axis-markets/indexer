const {NotImplemented} = require('../utils/interface-errors')

/**
 * @interface
 */
class HistoryStorage {
    /**
     * Store orderbook trade
     * @param {Trade} trade - Trade event
     * @param {string} cursor - Last processed event pagination cursor
     * @return {Promise<void>}
     * @abstract
     */
    async storeTrade(trade, cursor) {
        throw new NotImplemented()
    }

    /**
     * Store archived order
     * @param {Order} order - Order entry
     * @param {string} cursor - Last processed event pagination cursor
     * @abstract
     */
    async storeOrder(order, cursor) {
        throw new NotImplemented()
    }

    /**
     * Get last process DEX event id
     * @return {Promise<string>} - Last processed event pagination cursor
     * @abstract
     */
    async getCursor() {
        throw new NotImplemented()
    }

    /**
     * Load trades history
     * @param {{limit: number, [pair]: string, [trader]: string, [cursor]: bigint}} filter - Query filters
     * @return {Promise<Trade[]>}
     * @abstract
     */
    async loadTrades(filter) {
        throw new NotImplemented()
    }

    /**
     * Load active orders
     * @param {{limit: number, [owner]: string, [pair]: string, [cursor]: bigint}} filter - Query filters
     * @return {Promise<Order[]>}
     * @abstract
     */
    async loadActiveOrders(filter) {
        throw new NotImplemented()
    }

    /**
     * Load archived orders
     * @param {{limit: number, [owner]: string, [pair]: string, [cursor]: bigint}} filter - Query filters
     * @return {Promise<Order[]>}
     * @abstract
     */
    async loadArchivedOrders(filter) {
        throw new NotImplemented()
    }

    /**
     * Release resources
     * @return {Promise}
     * @virtual
     */
    async dispose(){
    }
}

module.exports = HistoryStorage