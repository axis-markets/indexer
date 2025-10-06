const {NotImplemented} = require('../utils/interface-errors')

class HistoryStorage {
    /**
     * Store orderbook trade
     * @param {Trade} trade
     * @return {Promise<void>}
     * @abstract
     */
    async storeTrade(trade) {
        throw new NotImplemented()
    }

    /**
     * Store archived order
     * @param {Order} order
     * @abstract
     */
    async storeOrder(order) {
        throw new NotImplemented()
    }

    /**
     * Load trades history
     * @param {{limit: number, [cursor]: string, [pair]: string[], [trader]: string}} filter
     * @return {Promise<Trade[]>}
     * @abstract
     */
    async getTrades(filter) {
        throw new NotImplemented()
    }

    /**
     * Load archived orders
     * @param {{limit: number, [owner]: string, [pair]: string[], [cursor]: string}} filter
     * @return {Promise<Order[]>}
     * @abstract
     */
    async getOrders(filter) {
        throw new NotImplemented()
    }

    /**
     * @return {Promise}
     * @virtual
     */
    dispose(){
    }
}

module.exports = HistoryStorage