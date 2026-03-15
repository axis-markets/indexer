const {NotImplemented} = require('../utils/interface-errors')
const fs = require('node:fs/promises')

/**
 * @interface
 */
class HistoryStorage {
    /**
     * Store orderbook trade
     * @param {Trade} trade
     * @return {Promise<void>}
     * @abstract
     */
    storeTrade(trade) {
        throw new NotImplemented()
    }

    /**
     * Store archived order
     * @param {Order} order
     * @abstract
     */
    storeOrder(order) {
        throw new NotImplemented()
    }

    /**
     * Get event stream cursor
     * @return {Promise<string>}
     * @abstract
     */
    async getCursor() {
        throw new NotImplemented()
    }

    /**
     * Load trades history
     * @param {{limit: number, [cursor]: string, [pair]: string, [trader]: string}} filter
     * @return {Promise<Trade[]>}
     * @abstract
     */
    async getTrades(filter) {
        throw new NotImplemented()
    }

    /**
     * Load archived orders
     * @param {{limit: number, [owner]: string, [pair]: string, [cursor]: string}} filter
     * @return {Promise<Order[]>}
     * @abstract
     */
    async getOrders(filter) {
        throw new NotImplemented()
    }

    /**
     * Set event stream cursor and save changes
     * @param {String} cursor
     * @return {Promise<void>}
     */
    async save(cursor) {
        this.storage.cursor = cursor
        await fs.writeFile(this.filePath, JSON.stringify(this.storage))
    }

    /**
     * @return {Promise}
     * @virtual
     */
    async dispose(){
    }
}

module.exports = HistoryStorage