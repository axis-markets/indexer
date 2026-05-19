const Order = require('./entries/order')
const Trade = require('./entries/trade')
const HistoryStorage = require('./history/history-storage')
const InMemoryHistoryStorage = require('./history/inmemory-history-storage')
const DataSource = require('./graph/data-source')
const OrderBookDispatcher = require('./graph/orderbook-dispatcher')
const {initApiServer} = require('./server/api')

class Indexer {
    /**
     * @param {DataSource} dataSource
     * @param {HistoryStorage} historyStorage
     * @param {number} [apiPort] - Port for REST API server, if omitted the server is disabled
     */
    constructor({dataSource, historyStorage, apiPort}) {
        this.dispatcher = new OrderBookDispatcher()
        this.dataSource = dataSource
        this.historyStorage = historyStorage
        dataSource.onTradeEvent = trade => {
            this.historyStorage.storeTrade(Trade.fromEvent(trade))
                .catch(e => console.error(e))
        }
        dataSource.onOrderEvent = orderEvent => {
            const order = Order.fromEvent(orderEvent)
            this.dispatcher.update(orderEvent.action, order)
            if (orderEvent.action === 'removed') {
                if (order.amount > 0n) {
                    order.status = Order.ORDER_STATUS.CANCELED
                }
                this.historyStorage.storeOrder(order)
                    .catch(e => console.error(e))
            }
        }
        if (apiPort) {
            initApiServer(this, apiPort)
                .catch(e => console.error(e))
        }
    }

    /**
     * @type {OrderBookDispatcher}
     * @readonly
     */
    dispatcher
    /**
     * @type {DataSource}
     * @readonly
     */
    dataSource
    /**
     * @type {HistoryStorage}
     * @readonly
     */
    historyStorage

    /**
     * Finalize and release resources
     */
    dispose() {
        this.dataSource?.dispose()
            .catch(e => console.error(e))
        this.historyStorage?.dispose()
            .catch(e => console.error(e))
    }
}

module.exports = {
    Indexer,
    OrderBookDispatcher,
    DataSource,
    HistoryStorage,
    InMemoryHistoryStorage,
    Order,
    Trade,
    initApiServer
}