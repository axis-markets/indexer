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

    //account state: every live order of the owner and the tracked backing in each asset they trade
    registerRoute(app,
        '/account/:address', {},
        req => indexer.dispatcher.getAccount(req.params.address))

    //maker backing (balance, allowance) in a token
    registerRoute(app,
        '/backing', {},
        req => indexer.dispatcher.getBacking(req.query))

    //contract state: frozen switch, configuration, markets opened by `subsidize`
    registerRoute(app,
        '/contract', {},
        req => indexer.contractState.toJSON())
}
