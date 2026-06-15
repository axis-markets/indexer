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
     * @param {'public'|'testnet'} network - Stellar network identifier
     * @param {string} contractAddress - AXIS contract address
     * @param contractAddress
     */
    constructor({dataSource, historyStorage, apiPort, network, contractAddress}) {
        this.dispatcher = new OrderBookDispatcher()
        this.dataSource = dataSource
        this.historyStorage = historyStorage
        this.network = network
        this.contractAddress = contractAddress
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
     * @type {string}
     * @readonly
     */
    network
    /**
     * @type {string}
     * @readonly
     */
    contractAddress

    /**
     * Initialize the indexer
     */
    async init() {
        //load last processed event cursor from the history storage
        const cursor = await this.historyStorage.getCursor()
        //load all active orders from historyStorage and update dispatcher status
        let activeOrderCursor
        const orderBatchSize = 4000
        while (true) {
            const orders = await this.historyStorage.loadActiveOrders({limit: orderBatchSize, cursor: activeOrderCursor})
            for (const order of orders) {
                this.dispatcher.update('created', order)
                activeOrderCursor = order.id
            }
            if (orders.length < orderBatchSize)
                break //all loaded
        }
        //initialize data source
        this.dataSource.onTradeEvent = trade => {
            this.historyStorage.storeTrade(Trade.fromEvent(trade), trade.cursor)
                .catch(e => console.error(e))
        }
        this.dataSource.onOrderEvent = orderEvent => {
            const order = Order.fromEvent(orderEvent)
            this.dispatcher.update(orderEvent.action, order)
            this.historyStorage.storeOrder(order, orderEvent.cursor)
                .catch(e => console.error(e))
        }
        await this.dataSource.init(this.network, this.contractAddress, cursor)
    }

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