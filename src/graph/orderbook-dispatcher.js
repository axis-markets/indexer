const {normalizeLimit, isValidActor, parseIdCursor} = require('../utils/validation')
const stdErrors = require('../server/errors')
const OrderBookGraph = require('./orderbook-graph')

class OrderBookDispatcher {
    constructor() {
        this.graph = new OrderBookGraph()
    }

    /**
     * @type {OrderBookGraph}
     * @readonly
     */
    graph
    /**
     * @type {{updated: number, markets: OrderbookMarketsList}}
     * @private
     */
    marketsCache = {updated: 0, markets: null}

    get ready() {
        return true
    }

    update() {
        //addOrder, removeOrder, or update amount
    }

    /**
     * Retrieve order by its id
     * @param {bigint|string} id
     */
    getOrder(id) {
        if (typeof id !== 'bigint') {
            try {
                if (typeof id !== 'string') {
                    id = id.toString()
                }
                id = BigInt(id)
            } catch (e) {
                throw stdErrors.badRequest('Invalid order ID')
            }
            if (id <= 0)
                throw stdErrors.badRequest('Invalid order ID')
        }
        const order = this.graph.allOrders.get(id)
        if (!order)
            return null
        return order.toJSON()
    }

    /**
     * Get active orders
     * @param {string} [owner]
     * @param {string[]|string} [asset]
     * @param {string|bigint} [cursor]
     * @param {string|number} [limit]
     * @returns {*[]}
     */
    getOrders({owner, asset, cursor, limit}) {
        if (asset) {
            try {
                if (typeof asset === 'string') {
                    asset = [asset] //ensure array
                }
                //TODO: validate asset contract addresses
            } catch (e) {
                throw stdErrors.validationError('asset')
            }
        }
        if (owner && !isValidActor(owner)) {
            throw stdErrors.validationError('owner')
        }
        if (cursor) {
            cursor = parseIdCursor(cursor)
        }
        limit = normalizeLimit(limit, 20, 200)

        const res = []
        for (const order of this.graph.allOrders.values()) {
            if (cursor && order.id <= cursor) //TODO: use binary search in case of cursor
                continue
            if (owner && order.owner !== owner)
                continue
            if (asset && !asset.every(a => order.selling === a || order.buying === a))
                continue
            const serialized = order.toJSON()
            serialized.cursor = serialized.id
            res.push(serialized)
            if (res.length >= limit)
                break
        }
        //TODO: wrap result?
        return res
    }

    /**
     * @param {string} cursor
     * @param {string|number} limit
     */
    getMarkets({cursor, limit}) {
        limit = normalizeLimit(limit, 20, 1000)
        let from
        if (cursor) {
            try {
                const pair = cursor.split('-')
                if (pair.length !== 2)
                    //TODO: validate asset contract addresses
                    throw stdErrors.validationError('cursor', 'Invalid cursor format')
                from = pair
            } catch (e) {
                throw stdErrors.validationError('cursor')
            }
        }
        const ts = new Date().getTime()
        if (ts - this.marketsCache.updated > 30 * 60 * 1000) { //update every 30 minutes
            this.marketsCache = {
                updated: ts,
                markets: this.graph.sellingGraph.getAllMarkets()
            }
        }

        const range = this.marketsCache.markets.range(limit, from)
        return range.map(assets => {
            return {
                baseAsset: assets[0],
                quoteAsset: assets[1],
                cursor: assets[0] + '-' + assets[1],
                orderTypes: [
                    'LIMIT'/*,
                    'MARKET',
                    'STOP_LOSS',
                    'ICEBERG'*/
                ]
            }
        })
    }
}

module.exports = OrderBookDispatcher