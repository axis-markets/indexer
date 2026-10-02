const {normalizeLimit, isValidActor, parseIdCursor} = require('../utils/validation')
const stdErrors = require('../server/errors')
const {formatDateUTC} = require('../utils/date')
const OrderBookGraph = require('./orderbook-graph')
const Order = require('../entries/order')

class OrderBookDispatcher {
    /**
     * @param {BackingTracker} [backing] - Maker backing tracker
     */
    constructor(backing) {
        this.graph = new OrderBookGraph(backing)
    }

    /**
     * @type {OrderBookGraph}
     * @readonly
     */
    graph
    /**
     * Current time source for the expiration checks, UNIX seconds
     * @type {function(): number}
     */
    clock = () => Math.floor(Date.now() / 1000)
    /**
     * @type {{updated: number, markets: OrderbookMarketsList}}
     * @private
     */
    marketsCache = {updated: 0, markets: null}

    /**
     * True once the maker backing of every loaded order has been fetched
     * @return {boolean}
     */
    get ready() {
        return this.graph.backing.ready
    }

    /**
     * Add a new order to the graph (`new` event or replay of a persisted order) and track the maker backing.
     * A `new` event may reuse the id of an expired order: the contract overwrites its entry, so the old order is
     * dropped from the graph and returned for archival
     * @param {Order} order
     * @return {Order|undefined} - Order replaced under the same id, if any
     */
    add(order) {
        const existing = this.graph.getOrder(order.id)
        if (existing === order)
            return undefined
        if (existing) {
            this.remove(existing)
        }
        this.graph.addOrder(order)
        if (order.status === Order.ORDER_STATUS.EXPIRED || order.isExpired(this.clock())) {
            //already expired (history replay): keep it for a revival, but out of the live orderbook
            this.graph.expireOrder(order)
            order.applyExpiration()
        } else {
            this.trackOrder(order)
        }
        return existing
    }

    /**
     * Apply a fill reported by a `trade` event
     * @param {bigint} orderId - Maker order id
     * @param {bigint} left - Order amount left after the fill (0 = removed)
     * @param {number} ts - Event timestamp
     * @return {Order|undefined} - Updated order, undefined if the order is unknown
     */
    fill(orderId, left, ts) {
        const order = this.graph.getOrder(orderId)
        if (!order) {
            console.error(`Failed to locate the order ${orderId} in the graph`)
            return undefined
        }
        order.applyFill(left, ts)
        if (left <= 0n) {
            this.remove(order)
        }
        return order
    }

    /**
     * Apply a `mod` event: change the amount, price and expiration of the order (reviving it if it has expired), or
     * remove it when the amount is zero
     * @param {bigint} orderId - Order id
     * @param {bigint} price - New price
     * @param {bigint} amount - New amount (0 = removed)
     * @param {number} expires - New expiration timestamp, UNIX seconds (0 = no expiration)
     * @param {number} ts - Event timestamp
     * @return {Order|undefined} - Updated order, undefined if the order is unknown
     */
    modify(orderId, price, amount, expires, ts) {
        const order = this.graph.getOrder(orderId)
        if (!order) {
            console.error(`Failed to locate the order ${orderId} in the graph`)
            return undefined
        }
        if (amount <= 0n) {
            order.applyMod(price, amount, expires, ts)
            this.remove(order)
            return order
        }
        //re-insert the order at its new price level
        const live = this.graph.detachOrder(order)
        order.applyMod(price, amount, expires, ts)
        this.graph.attachOrder(order)
        if (order.isExpired(this.clock())) {
            //the new expiration has passed already (history replay)
            this.graph.expireOrder(order)
            order.applyExpiration()
            if (live) {
                this.untrackOrder(order)
            }
        } else if (live) {
            //an update may grant a new allowance
            this.graph.backing.refreshAfterEvent(order.owner, order.selling)
        } else {
            //revived expired order
            this.trackOrder(order)
        }
        return order
    }

    /**
     * Apply a `skip` event: the listed order was left unchanged because its maker could not settle the fill (backing
     * short of it, cannot receive the taker's asset, or the transfer failed). The maker's backing is reloaded and the
     * skip is recorded on the backing of the asset the order sells, so routers can stop proposing the maker
     * @param {bigint} orderId - Skipped order id
     * @param {number} ts - Event timestamp
     * @return {Order|undefined} - Skipped order, undefined if the order is unknown
     */
    skip(orderId, ts) {
        const order = this.graph.getOrder(orderId)
        if (!order)
            return undefined
        const {backing} = this.graph
        backing.markSkipped(order.owner, order.selling, ts)
        for (const asset of [order.selling, order.buying]) {
            if (backing.get(order.owner, asset)) {
                backing.refreshAfterSkip(order.owner, asset)
            }
        }
        return order
    }

    /**
     * Take the orders expired by `now` out of the live orderbook, mark them `EXPIRED` and stop tracking their backing.
     * They are kept out of the API, but stay in the graph until the owner removes or revives them, or a new order
     * reuses the id
     * @param {number} now - Current timestamp, UNIX seconds
     * @return {Order[]} - Orders that expired since the previous check, to be archived
     */
    expire(now) {
        const expired = this.graph.expireOrders(now)
        for (const order of expired) {
            order.applyExpiration()
            this.untrackOrder(order)
        }
        return expired
    }

    /**
     * Drop the order from the graph, releasing its backing references if it was live
     * @param {Order} order
     * @private
     */
    remove(order) {
        if (this.graph.isLive(order.id)) {
            this.untrackOrder(order)
        }
        this.graph.removeOrder(order.id)
    }

    /**
     * Track the maker backing in both order assets (selling side funds the order, buying side must be receivable)
     * @param {Order} order
     * @private
     */
    trackOrder(order) {
        this.graph.backing.track(order.owner, order.selling)
        this.graph.backing.track(order.owner, order.buying)
    }

    /**
     * @param {Order} order
     * @private
     */
    untrackOrder(order) {
        this.graph.backing.untrack(order.owner, order.selling)
        this.graph.backing.untrack(order.owner, order.buying)
    }

    /**
     * Retrieve order by its id
     * @param {bigint|string} id
     * @return {{}} - Serialized order
     * @throws {Error} - 404 error if the order is not live (missing or expired)
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
            if (id < 0n)
                throw stdErrors.badRequest('Invalid order ID')
        }
        if (!this.graph.isLive(id))
            throw stdErrors.notFound('Order not found')
        return this.serialize(this.graph.getOrder(id))
    }

    /**
     * Get active orders in creation order
     * @param {string} [owner]
     * @param {string[]|string} [asset]
     * @param {string|bigint} [cursor] - Position of the last order received (exclusive)
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
        const memo = new Map()
        //orders are kept in insertion order, which is the creation order
        for (const order of this.graph.allOrders.values()) {
            if (cursor && order.position <= cursor) //TODO: use binary search in case of cursor
                continue
            if (!this.graph.isLive(order.id)) //expired orders are archived
                continue
            if (owner && order.owner !== owner)
                continue
            if (asset && !asset.every(a => order.selling === a || order.buying === a))
                continue
            res.push(this.serialize(order, memo))
            if (res.length >= limit)
                break
        }
        //TODO: wrap result?
        return res
    }

    /**
     * Get tracked backing of a maker in a token
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @return {{}}
     * @throws {Error} - 404 error if the pair is not tracked
     */
    getBacking({owner, asset}) {
        if (!isValidActor(owner))
            throw stdErrors.validationError('owner')
        if (typeof asset !== 'string' || !asset)
            throw stdErrors.validationError('asset')
        const backing = this.serializeBacking(owner, asset)
        if (!backing)
            throw stdErrors.notFound('Backing is not tracked for the owner and asset')
        return backing
    }

    /**
     * Account state of an order owner: every live order (not paginated) and the tracked backing in each asset they
     * trade or that is watched for them (records not loaded yet are left out)
     * @param {string} owner - Account address
     * @return {{address: string, ledger: number, orders: {}[], backing: Object<string, {}>}}
     */
    getAccount(owner) {
        if (!isValidActor(owner))
            throw stdErrors.validationError('owner')
        const memo = new Map()
        const orders = this.graph.getOwnerOrders(owner)
        const backing = {}
        for (const asset of this.graph.backing.assetsOf(owner)) {
            if (this.graph.backing.get(owner, asset)?.updated) {
                backing[asset] = this.serializeBacking(owner, asset)
            }
        }
        return {
            address: owner,
            ledger: this.graph.lastLedger,
            orders: orders.map(order => this.serialize(order, memo)),
            backing
        }
    }

    /**
     * Serialize the tracked backing of a maker in a token
     * @param {string} owner - Account address
     * @param {string} asset - Token contract address
     * @return {{}|undefined} - Undefined if not tracked
     */
    serializeBacking(owner, asset) {
        const backing = this.graph.backing.describe(owner, asset, this.graph.lastLedger)
        if (!backing)
            return undefined
        const res = {
            owner,
            asset,
            balance: backing.balance.toString(),
            allowance: backing.allowance.toString(),
            liveUntil: backing.liveUntil,
            authorized: backing.authorized,
            budget: backing.budget.toString(),
            updated: backing.updated ? formatDateUTC(backing.updated) : undefined,
            skipped: backing.skipped ? formatDateUTC(backing.skipped) : undefined
        }
        if (backing.pending) {
            res.pending = true
        }
        return res
    }

    /**
     * Split the maker budget in the asset, min(balance, allowance), across their live orders selling it, oldest first:
     * one balance and one allowance back every order selling the token, across all markets. The contract has no
     * priority between them, so this estimates which orders are left uncovered
     * @param {string} owner - Account address
     * @param {string} asset - Token sold
     * @param {Map<string, Map<bigint, bigint>>} [memo] - Allocations computed within the same request
     * @return {Map<bigint, bigint>} - Order id -> deliverable amount
     */
    allocateBacking(owner, asset, memo) {
        const key = owner + '|' + asset
        let res = memo?.get(key)
        if (res)
            return res
        res = new Map()
        let left = this.graph.backing.getBudget(owner, asset, this.graph.lastLedger)
        for (const order of this.graph.getOwnerOrders(owner)) {
            if (order.selling !== asset)
                continue
            const share = order.amount < left ? order.amount : left
            res.set(order.id, share)
            left -= share
        }
        memo?.set(key, res)
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

        const range = this.marketsCache.markets.range(from, limit)
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

    /**
     * Serialize an order together with the tracked backing of its maker and its share of it
     * @param {Order} order
     * @param {Map<string, Map<bigint, bigint>>} [memo] - Allocations computed within the same request
     * @return {{}}
     */
    serialize(order, memo) {
        const backing = this.graph.backing.describe(order.owner, order.selling, this.graph.lastLedger)
        if (!backing)
            return order.toJSON()
        const backed = this.graph.isLive(order.id) ?
            this.allocateBacking(order.owner, order.selling, memo).get(order.id) ?? 0n :
            0n
        return order.toJSON(backing, backed)
    }
}

module.exports = OrderBookDispatcher
