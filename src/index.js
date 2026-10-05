const {EventEmitter} = require('events')
const Order = require('./entries/order')
const Trade = require('./entries/trade')
const Swap = require('./entries/swap')
const Failure = require('./entries/failure')
const HistoryStorage = require('./history/history-storage')
const InMemoryHistoryStorage = require('./history/inmemory-history-storage')
const DataSource = require('./graph/data-source')
const OrderBookDispatcher = require('./graph/orderbook-dispatcher')
const BackingTracker = require('./graph/backing-tracker')
const ContractState = require('./graph/contract-state')
const {initApiServer} = require('./server/api')
const {PRECISION} = require('./utils/price')
const {toPair, canonicalPair, compareAssets} = require('./utils/asset-pair')
const orderbookRoutes = require('./routes/orderbook-routes')
const historyRoutes = require('./routes/history-routes')

/**
 * Scans AXIS contract events and maintains the orderbook, the history and the contract state.
 *
 * Emits (payloads are live entities, serialize them before sending):
 * - `order` {@link IndexerOrderChange} - an order was created, filled, updated, canceled or expired
 * - `trade` {@link Trade} - a fill was stored
 * - `swap` {@link Swap} - a swap was stored
 * - `failure` {@link Failure} - a transaction calling the contract failed (data sources that see failed transactions)
 * - `backing` `{owner, asset}` - the tracked backing of a maker changed (balance, allowance, authorization, pending)
 * - `contract` `{kind: 'freeze'|'config'|'market', market?: ContractMarket}` - the contract state changed
 * - `ledger` `number` - a ledger was processed: with a streaming data source after its events and backing changes
 *   (every ledger), otherwise when the first event of a new ledger arrives
 */
class Indexer extends EventEmitter {
    /**
     * @param {DataSource} dataSource
     * @param {HistoryStorage} historyStorage
     * @param {number} [apiPort] - Port for REST API server, if omitted the server is disabled
     * @param {'public'|'testnet'} network - Stellar network identifier
     * @param {string} contractAddress - AXIS contract address
     * @param {BackingTrackerOptions} [backing] - Maker backing tracker settings
     * @param {number} [expirationInterval] - Period of the expired orders check, in milliseconds (default 10000)
     */
    constructor({dataSource, historyStorage, apiPort, network, contractAddress, backing, expirationInterval = 10_000}) {
        super()
        this.setMaxListeners(0) //one listener per API subscription channel
        this.dataSource = dataSource
        this.historyStorage = historyStorage
        this.network = network
        this.contractAddress = contractAddress
        this.expirationInterval = expirationInterval
        this.backing = new BackingTracker((asset, owner) => dataSource.loadBacking(asset, owner, contractAddress), {
            ...backing,
            //a streaming data source pushes the backing of the subscribed makers instead of being polled
            stream: dataSource?.streamsBacking ? {
                subscribe: (asset, owner) => dataSource.subscribeBacking(asset, owner, contractAddress),
                unsubscribe: (asset, owner) => dataSource.unsubscribeBacking(asset, owner, contractAddress)
            } : undefined,
            onChange: (owner, asset) => this.emit('backing', {owner, asset})
        })
        this.dispatcher = new OrderBookDispatcher(this.backing)
        this.dispatcher.graph.contract = contractAddress
        this.contractState = new ContractState(contractAddress)
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
     * Maker backing tracker (also reachable as `dispatcher.graph.backing`)
     * @type {BackingTracker}
     * @readonly
     */
    backing
    /**
     * Contract-level state: frozen switch, configuration, markets
     * @type {ContractState}
     * @readonly
     */
    contractState
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
     * Period of the expired orders check, in milliseconds
     * @type {number}
     * @readonly
     */
    expirationInterval
    /**
     * Cursor of the last processed contract event
     * @type {string}
     * @private
     */
    cursor
    /**
     * Last ledger reported with the `ledger` event
     * @type {number}
     * @private
     */
    reportedLedger = 0
    /**
     * Market assets whose AXIS contract record is tracked (authorization to hold the asset in transit)
     * @type {Set<string>}
     * @private
     */
    contractAssets = new Set()
    /**
     * Trade events of the transaction being processed (crossfill detection)
     * @type {{tx: bigint, trades: TradeEvent[]}}
     * @private
     */
    txTrades = {tx: -1n, trades: []}
    /**
     * @type {NodeJS.Timeout}
     * @private
     */
    expirationTimer

    /**
     * Initialize the indexer
     */
    async init() {
        //load last processed event cursor from the history storage
        const cursor = await this.historyStorage.getCursor()
        this.contractState.restore(await this.historyStorage.loadContractState())
        for (const market of this.contractState.markets.values()) {
            this.trackContractAsset(market.base)
            this.trackContractAsset(market.quote)
        }
        this.cursor = cursor
        //rebuild the graph in creation order from the active orders and the expired ones their owners can still revive
        const active = await loadAllOrders(filter => this.historyStorage.loadActiveOrders(filter))
        const expired = await loadAllOrders(filter => this.historyStorage.loadArchivedOrders({...filter, status: Order.ORDER_STATUS.EXPIRED}))
        const byId = new Map()
        for (const order of expired) {
            //an id may have expired several times, only the latest order can still be on-chain
            const known = byId.get(order.id)
            if (!known || known.position < order.position) {
                byId.set(order.id, order)
            }
        }
        for (const order of active) {
            byId.set(order.id, order) //an active order took the id of the expired one
        }
        const replay = [...byId.values()]
            .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
        for (const order of replay) {
            const wasActive = order.status === Order.ORDER_STATUS.ACTIVE
            this.dispatcher.add(order)
            if (wasActive && order.status !== Order.ORDER_STATUS.ACTIVE) {
                this.storeOrder(order) //expired while the indexer was down
            }
        }
        this.expireOrders()
        //initialize data source
        this.dataSource.onTradeEvent = tradeEvent => this.processTrade(tradeEvent)
        //swaps are stored in the same history log as trades, tagged with type='swap'
        this.dataSource.onSwapEvent = swapEvent => this.processSwap(swapEvent)
        this.dataSource.onOrderEvent = orderEvent => this.processOrderEvent(orderEvent)
        this.dataSource.onSkipEvent = skipEvent => this.processSkip(skipEvent)
        this.dataSource.onMarketEvent = marketEvent => this.processMarket(marketEvent)
        this.dataSource.onFreezeEvent = freezeEvent => this.processFreeze(freezeEvent)
        this.dataSource.onConfigEvent = configEvent => this.processConfig(configEvent)
        this.dataSource.onFailureEvent = failureEvent => this.processFailure(failureEvent)
        this.dataSource.onError = e => console.error('Data source error', e)
        if (this.dataSource.streamsBacking) {
            this.dataSource.onBackingEvent = backingEvent => this.processBacking(backingEvent)
            this.dataSource.onLedger = ledger => this.processLedger(ledger)
        }
        this.backing.start()
        this.expirationTimer = setInterval(() => this.expireOrders(), this.expirationInterval)
        this.expirationTimer.unref?.()
        await this.dataSource.init(this.network, this.contractAddress, cursor)
    }

    /**
     * Finalize and release resources
     */
    dispose() {
        this.backing.stop()
        clearInterval(this.expirationTimer)
        this.dataSource?.dispose()
            .catch(e => console.error(e))
        this.historyStorage?.dispose()
            .catch(e => console.error(e))
    }

    /**
     * Track the backing of an account in the given tokens regardless of its orders (e.g. a trader connected to a push
     * API), one reference per asset shared with its orders: a streaming data source subscribes each pair once
     * @param {string} owner - Account address
     * @param {string[]} assets - Token contract addresses
     * @return {Promise<void>} - Resolves once the backing of every asset is loaded
     */
    async watchBacking(owner, assets) {
        for (const asset of assets) {
            this.backing.track(owner, asset)
        }
        await Promise.all(assets.map(asset => this.backing.whenLoaded(owner, asset)))
    }

    /**
     * Release the references taken by {@link watchBacking}
     * @param {string} owner - Account address
     * @param {string[]} assets - Token contract addresses
     */
    unwatchBacking(owner, assets) {
        for (const asset of assets) {
            this.backing.untrack(owner, asset)
        }
    }

    /**
     * Take the orders that have expired out of the live orderbook and archive them as `EXPIRED` (the contract emits
     * nothing on expiration)
     * @param {number} [now] - Current timestamp, UNIX seconds
     * @return {Order[]} - Orders that expired since the previous check
     */
    expireOrders(now = this.dispatcher.clock()) {
        const expired = this.dispatcher.expire(now)
        for (const order of expired) {
            this.storeOrder(order)
            this.emitOrder('expire', order)
        }
        return expired
    }

    /**
     * @param {OrderEvent} orderEvent
     * @private
     */
    processOrderEvent(orderEvent) {
        this.advance(orderEvent)
        let order
        switch (orderEvent.action) {
            case 'new': {
                order = Order.fromCreatedEvent(orderEvent)
                //the id of an expired order can be reused, the new order overwrites its entry
                const replaced = this.dispatcher.add(order)
                if (replaced) {
                    //archived already unless it expired after the last expiration check
                    if (replaced.status === Order.ORDER_STATUS.ACTIVE) {
                        replaced.applyExpiration()
                        this.emitOrder('expire', replaced)
                    }
                    this.storeOrder(replaced)
                }
                //the trade that created the order usually granted an allowance in the same call, which no AXIS event
                //reports: reload the owner's backing of the sold asset (deduplicated with the load `add` may start, rechecked later)
                if (this.backing.get(order.owner, order.selling)) {
                    this.backing.refreshAfterEvent(order.owner, order.selling)
                }
                this.storeOrder(order)
                this.emitOrder('new', order)
                return
            }
            case 'mod':
                order = this.dispatcher.modify(orderEvent.id, orderEvent.price, orderEvent.amount, orderEvent.expires, orderEvent.ts)
                if (!order)
                    return
                this.storeOrder(order)
                switch (order.status) {
                    case Order.ORDER_STATUS.CANCELED:
                        return this.emitOrder('cancel', order)
                    case Order.ORDER_STATUS.EXPIRED:
                        return this.emitOrder('expire', order)
                    default:
                        return this.emitOrder('update', order)
                }
            default:
                throw new Error('Unknown order event action: ' + orderEvent.action)
        }
    }

    /**
     * @param {TradeEvent} tradeEvent
     * @private
     */
    processTrade(tradeEvent) {
        this.advance(tradeEvent)
        //a data source reading the call tree knows it exactly, the event pattern stands in otherwise
        const pattern = this.isCrossfillSettlement(tradeEvent)
        const crossfill = typeof tradeEvent.crossfill === 'boolean' ? tradeEvent.crossfill : pattern
        const order = this.dispatcher.fill(tradeEvent.order, tradeEvent.left, tradeEvent.ts)
        const trade = Trade.fromEvent(crossfill ? {...tradeEvent, crossfill} : tradeEvent)
        if (order) {
            this.storeOrder(order)
            //the maker delivered what the taker bought
            const fill = {
                sold: tradeEvent.bought,
                bought: tradeEvent.sold,
                taker: tradeEvent.taker,
                trade: trade.id,
                ts: tradeEvent.ts
            }
            if (crossfill) {
                fill.crossfill = true
            }
            this.emitOrder(tradeEvent.left > 0n ? 'fill' : 'filled', order, fill)
        }
        this.historyStorage.storeTrade(trade, tradeEvent.cursor)
            .catch(e => console.error(e))
        this.emit('trade', trade)
        //balances of both parties changed in both assets
        for (const party of [tradeEvent.maker, tradeEvent.taker]) {
            for (const asset of [tradeEvent.soldAsset, tradeEvent.boughtAsset]) {
                if (this.backing.get(party, asset)) {
                    this.backing.refreshAfterEvent(party, asset)
                }
            }
        }
    }

    /**
     * Whether the trade event looks like the fill of a `crossfill` taker order, for data sources that cannot tell (no
     * call tree). The contract settles the makers first, each fill naming the taker order owner as the taker, then
     * reports the taker order fill with the caller as the taker and the owner as the maker, in the opposite direction,
     * for exactly what the owner paid the makers. So the event follows, in the same transaction, fills whose taker is
     * its maker, in the opposite direction, whose sold amounts add up to its bought amount. Fills of later `swap` hops
     * name the contract as the taker and never match. Two unrelated calls of one transaction (through a router) could
     * match by coincidence, which the call tree rules out
     * @param {TradeEvent} tradeEvent
     * @return {boolean}
     * @private
     */
    isCrossfillSettlement(tradeEvent) {
        //positions are TOID-based: ledger, application order, operation, then a 16-bit event index
        const tx = BigInt(tradeEvent.position ?? tradeEvent.id ?? 0n) >> 28n
        if (this.txTrades.tx !== tx) {
            this.txTrades = {tx, trades: []}
        }
        const {trades} = this.txTrades
        let match = false
        if (tradeEvent.taker !== this.contractAddress) {
            let paid = 0n
            for (let i = trades.length - 1; i >= 0; i--) {
                const fill = trades[i]
                if (fill.taker !== tradeEvent.maker || fill.soldAsset !== tradeEvent.boughtAsset || fill.boughtAsset !== tradeEvent.soldAsset)
                    break
                paid += fill.sold
                if (paid === tradeEvent.bought) {
                    match = true
                    break
                }
            }
        }
        trades.push(tradeEvent)
        return match
    }

    /**
     * @param {SwapEvent} swapEvent
     * @private
     */
    processSwap(swapEvent) {
        this.advance(swapEvent)
        const swap = Swap.fromEvent(swapEvent)
        this.historyStorage.storeTrade(swap, swapEvent.cursor)
            .catch(e => console.error(e))
        this.emit('swap', swap)
    }

    /**
     * A listed order its maker could not settle: the order is unchanged, the maker backing is reloaded
     * @param {SkipEvent} skipEvent
     * @private
     */
    processSkip(skipEvent) {
        this.advance(skipEvent)
        this.dispatcher.skip(skipEvent.order, skipEvent.ts)
    }

    /**
     * @param {MarketRefreshEvent} marketEvent
     * @private
     */
    processMarket(marketEvent) {
        this.advance(marketEvent)
        this.contractState.refreshMarket(marketEvent.base, marketEvent.quote, marketEvent.ts)
        this.trackContractAsset(marketEvent.base)
        this.trackContractAsset(marketEvent.quote)
        this.storeContractState()
        this.emit('contract', {kind: 'market', market: this.contractState.getMarket(marketEvent.base, marketEvent.quote)})
    }

    /**
     * A transaction calling the contract failed. It changed no state: the failure is stored and reported for
     * diagnostics, and never counts against a maker or a taker (a token error on a payment does not tell the payer from
     * the recipient, and in a `crossfill` the payer is the taker order owner, not the caller)
     * @param {FailureEvent} failureEvent
     * @private
     */
    processFailure(failureEvent) {
        const failure = Failure.fromEvent(failureEvent)
        this.historyStorage.storeFailure(failure)
            .catch(e => console.error(e))
        this.emit('failure', failure)
    }

    /**
     * Track the AXIS contract's own record in a market asset: makers deliver what a taker buys to the contract, which
     * forwards it, so an asset whose issuer requires authorization can be bought only once the issuer authorized the
     * contract (`IntermediaryCannotReceive` otherwise)
     * @param {string} asset - Token contract address
     * @private
     */
    trackContractAsset(asset) {
        if (!this.contractAddress || this.contractAssets.has(asset))
            return
        this.contractAssets.add(asset)
        this.backing.track(this.contractAddress, asset)
    }

    /**
     * @param {FreezeEvent} freezeEvent
     * @private
     */
    processFreeze(freezeEvent) {
        this.advance(freezeEvent)
        this.contractState.applyFreeze(freezeEvent.frozen)
        this.storeContractState()
        this.emit('contract', {kind: 'freeze'})
    }

    /**
     * @param {ConfigEvent} configEvent
     * @private
     */
    processConfig(configEvent) {
        this.advance(configEvent)
        this.contractState.applyConfig(configEvent)
        this.storeContractState()
        this.emit('contract', {kind: 'config'})
    }

    /**
     * Apply a backing change pushed by a streaming data source
     * @param {BackingEvent} backingEvent
     * @private
     */
    processBacking(backingEvent) {
        if (backingEvent.spender && backingEvent.spender !== this.contractAddress)
            return //allowance granted to another spender
        this.backing.apply(backingEvent.owner, backingEvent.asset, backingEvent)
    }

    /**
     * A ledger was processed by a streaming data source (with or without AXIS events)
     * @param {number} ledger
     * @private
     */
    processLedger(ledger) {
        const {graph} = this.dispatcher
        if (ledger > graph.lastLedger) {
            graph.updateLastLedger(ledger) //allowance expirations are checked against it
        }
        //persist the progress past the ledger: event cursors alone fall out of the source retention on a quiet contract
        const {cursor} = this.dataSource
        if (cursor && cursor !== this.cursor) {
            this.cursor = cursor
            this.historyStorage.storeCursor(cursor)
                .catch(e => console.error(e))
        }
        this.backing.advanceLedger(ledger)
        this.emitLedger(ledger)
    }

    /**
     * Account for a processed contract event
     * @param {ContractEventBase} event
     * @private
     */
    advance(event) {
        this.dispatcher.graph.updateLastLedger(event.ledger)
        this.cursor = event.cursor
        if (!this.dataSource?.streamsBacking) {
            this.emitLedger(event.ledger) //no end-of-ledger signal: report the ledger with its first event
        }
    }

    /**
     * Emit `ledger` once per ledger
     * @param {number} ledger
     * @private
     */
    emitLedger(ledger) {
        if (ledger <= this.reportedLedger)
            return
        this.reportedLedger = ledger
        this.emit('ledger', ledger)
    }

    /**
     * @param {IndexerOrderAction} action
     * @param {Order} order
     * @param {IndexerFill} [fill]
     * @private
     */
    emitOrder(action, order, fill) {
        const change = {action, order}
        if (fill) {
            change.fill = fill
        }
        this.emit('order', change)
    }

    /**
     * @param {Order} order
     * @private
     */
    storeOrder(order) {
        this.historyStorage.storeOrder(order, this.cursor)
            .catch(e => console.error(e))
    }

    /**
     * @private
     */
    storeContractState() {
        this.historyStorage.storeContractState(this.contractState.snapshot(), this.cursor)
            .catch(e => console.error(e))
    }
}

/**
 * Load every order of a newest-first storage query in batches (exclusive `position` cursor)
 * @param {function({limit: number, cursor?: bigint}): Promise<Order[]>} load
 * @return {Promise<Order[]>}
 */
async function loadAllOrders(load) {
    const res = []
    const limit = 4000
    let cursor
    while (true) {
        const orders = await load({limit, cursor})
        for (const order of orders) {
            res.push(order)
            cursor = order.position
        }
        if (orders.length < limit)
            return res //all loaded
    }
}

module.exports = {
    Indexer,
    OrderBookDispatcher,
    BackingTracker,
    ContractState,
    DataSource,
    HistoryStorage,
    InMemoryHistoryStorage,
    Order,
    Trade,
    Swap,
    Failure,
    initApiServer,
    orderbookRoutes,
    historyRoutes,
    toPair,
    canonicalPair,
    compareAssets,
    PRECISION
}

/**
 * @typedef {'new'|'fill'|'filled'|'update'|'cancel'|'expire'} IndexerOrderAction - `fill` is partial, `filled`
 *   removed the order; `update` may also revive an expired order
 */

/**
 * @typedef {Object} IndexerOrderChange
 * @property {IndexerOrderAction} action
 * @property {Order} order - Order after the change
 * @property {IndexerFill} [fill] - Fill details (`fill` and `filled` only)
 */

/**
 * @typedef {Object} IndexerFill - A fill from the maker's perspective
 * @property {bigint} sold - Amount of the order's `selling` asset delivered
 * @property {bigint} bought - Amount of the order's `buying` asset received
 * @property {string} taker - Taker address
 * @property {bigint} trade - Trade id
 * @property {number} ts - Trade timestamp, UNIX seconds
 * @property {boolean} [crossfill] - The fill of a `crossfill` taker order (`taker` is the caller paid the surplus)
 */
