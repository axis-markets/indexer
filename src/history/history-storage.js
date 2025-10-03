const Order = require('../entries/order')
const {NotImplemented} = require('../utils/interface-errors')

class HistoryStorage {
    /**
     * Store orderbook trade
     * @param {Trade} trade
     * @return {Promise<void>}
     */
    async storeTrade(trade) {
        throw new NotImplemented()
    }

    /**
     * Store archived order
     * @param {Order} order
     */
    async storeOrder(order) {
        if (order.status === Order.ORDER_STATUS.ACTIVE)
            throw new Error('Attempt to archive active order ' + order.id)
        throw new NotImplemented()
    }

    /**
     * Load trades history
     * @param {{limit: number, [cursor]: string, [pair]: string[], [trader]: string}} filter
     * @return {Promise<Trade[]>}
     */
    async getTrades(filter) {
        throw new NotImplemented()
    }

    /**
     * Load archived orders
     * @param {{limit: number, [owner]: string, [pair]: string[], [cursor]: string}} filter
     * @return {Promise<Order[]>}
     */
    async getOrders(filter) {
        throw new NotImplemented()
    }

    /**
     * @virtual
     * @return {Promise}
     */
    dispose(){
    }
}

module.exports = HistoryStorage