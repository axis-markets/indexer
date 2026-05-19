const {registerRoute} = require('../server/router')
const {formatDateUTC} = require('../utils/date')

module.exports = function (app, indexer) {
    registerRoute(app,
        '/',
        {},
        async req => {
            const res = {
                status: 'loading',
                ts: formatDateUTC(new Date()),
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