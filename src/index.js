const HistoryStorage = require('./history/history-storage')
const DataLoader = require('./graph/loader')
const OrderBookDispatcher = require('./graph/orderbook-dispatcher')
const {initApiServer} = require('./server/api')

class Indexer {
    /**
     * @param {DataLoader} dataLoader
     * @param {HistoryStorage} historyStorage
     * @param {number} [apiPort] - Port for REST API  server, if omitted the server is disabled
     */
    constructor({dataLoader, historyStorage, apiPort}) {
        this.dispatcher = new OrderBookDispatcher()
        this.loader = dataLoader
        this.historyStorage = historyStorage
        dataLoader.listen(evt => this.dispatcher.update(evt))
        if (apiPort) {
            initApiServer(this.dispatcher, apiPort)
                .catch(e => console.error(e))
        }
    }

    /**
     * @type {OrderBookDispatcher}
     * @readonly
     */
    dispatcher
    /**
     * @type {DataLoader}
     * @readonly
     */
    loader
    /**
     * @type {HistoryStorage}
     * @readonly
     */
    historyStorage

    /**
     * Finalize and release resources
     */
    dispose() {
        this.loader?.dispose()
            .catch(e => console.error(e))
        this.historyStorage?.dispose()
            .catch(e => console.error(e))
    }
}

module.exports = {Indexer, OrderBookDispatcher, DataLoader, HistoryStorage, initApiServer}