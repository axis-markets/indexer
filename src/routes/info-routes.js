const {registerRoute} = require('../server/router')

module.exports = function (app, indexer) {
    registerRoute(app,
        '/',
        {},
        async req => {
            const res = {
                status: 'loading',
                ts: new Date().toISOString().replace(/\.\d+/, ''),
                commission: {
                    maker: 0,
                    taker: 0
                }
            }
            if (indexer.dispatcher.ready) {
                res.status = 'active'
                res.ledger = indexer.dispatcher.graph.lastLedger
            }
            return res
        })
}