const {registerRoute} = require('../server/router')
const HistoryDispatcher = require('../history/history-dispatcher')

/**
 * @param {{}} app
 * @param {Indexer} indexer
 */
module.exports = function (app, indexer) {
    const dispatcher = new HistoryDispatcher(indexer.historyStorage)
    //archived orders from db
    registerRoute(app,
        '/order-history', {},
        async req => await dispatcher.loadOrdersHistory(req.query))

    //get recent trades
    registerRoute(app,
        '/trades', {},
        async req => await dispatcher.loadTradesHistory(req.query))

    //failed AXIS transactions (diagnostics only, never attributed to a party)
    registerRoute(app,
        '/failures', {},
        async req => await dispatcher.loadFailures(req.query))
}
