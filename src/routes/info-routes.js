const {registerRoute} = require('../server/router')
const {formatDateUTC} = require('../utils/date')

module.exports = function (app, indexer) {
    registerRoute(app,
        '/',
        {},
        async req => {
            const res = {
                status: indexer.dispatcher.ready ? 'active' : 'loading',
                ts: formatDateUTC(new Date()),
                ledger: indexer.dispatcher.graph.lastLedger,
                frozen: indexer.contractState.frozen,
                commission: {
                    maker: 0,
                    taker: 0
                }
            }
            return res
        })
}
