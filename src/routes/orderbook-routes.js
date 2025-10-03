const {registerRoute} = require('../server/router')

/**
 * @param {{}} app
 * @param {Indexer} indexer
 */
module.exports = function (app, indexer) {
    //all active markets
    registerRoute(app,
        '/markets',
        {},
        req => indexer.dispatcher.getMarkets(req.query))

    //individual order
    registerRoute(app,
        '/order/:id', {},
        req => indexer.dispatcher.getOrder(req.params.id))

    //filtered orders list
    registerRoute(app,
        '/order', {},
        req => indexer.dispatcher.getOrders(req.query))
}
