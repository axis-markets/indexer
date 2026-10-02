const {Indexer, InMemoryHistoryStorage, DataSource, Order, Trade, Swap} = require('../src/index')
const {Keypair} = require('@stellar/stellar-sdk')
const {makeOrder} = require('./helpers/order-factory')

const MAKER = 'GMAKER'
const TAKER = 'GTAKER'
const USD = 'CUSD'
const EUR = 'CEUR'

/** Fake data source: records init arguments, lets tests push events, serves canned backing */
class FakeDataSource extends DataSource {
    initArgs
    backing = new Map()
    loads = []

    async init(network, contractAddress, cursor) {
        this.initArgs = {network, contractAddress, cursor}
    }

    async loadBacking(asset, owner, spender) {
        this.loads.push([asset, owner, spender])
        return this.backing.get(owner + '|' + asset) ?? {balance: 0n, authorized: false, allowance: 0n, liveUntil: 0}
    }

    async dispose() {
    }
}

function base(position, ledger = 100) {
    return {position, ledger, cursor: `${position}-0000`, ts: 1_700_000_000 + Number(position)}
}

function created(id, overrides = {}) {
    return {action: 'new', id, owner: MAKER, selling: USD, buying: EUR, price: 2n * 10n ** 18n, amount: 1000n, ...base(BigInt(id) * 10n), ...overrides}
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve))
}

async function setup(options = {}) {
    const dataSource = new FakeDataSource()
    dataSource.backing.set(`${MAKER}|${USD}`, {balance: 5000n, authorized: true, allowance: 700n, liveUntil: 10_000})
    dataSource.backing.set(`${MAKER}|${EUR}`, {balance: 0n, authorized: true, allowance: 0n, liveUntil: 0})
    const historyStorage = new InMemoryHistoryStorage()
    const indexer = new Indexer({dataSource, historyStorage, network: 'testnet', contractAddress: 'CAXIS', backing: {staleAfter: 60_000, ...options}})
    await indexer.init()
    return {indexer, dataSource, historyStorage}
}

describe('Indexer event processing', () => {
    let ctx

    beforeEach(async () => {
        ctx = await setup()
    })

    afterEach(() => {
        ctx.indexer.dispose()
    })

    test('init resumes the data source from the stored cursor', async () => {
        expect(ctx.dataSource.initArgs).toEqual({network: 'testnet', contractAddress: 'CAXIS', cursor: undefined})
    })

    test('new event creates the order, tracks the maker backing and persists the active order', async () => {
        ctx.dataSource.onOrderEvent(created(1n))
        await flush()
        const order = ctx.indexer.dispatcher.graph.getOrder(1n)
        expect(order).toBeInstanceOf(Order)
        expect(order.quote).toBe(1000n)
        expect(ctx.indexer.dispatcher.graph.lastLedger).toBe(100)
        expect(ctx.dataSource.loads).toEqual(expect.arrayContaining([[USD, MAKER, 'CAXIS'], [EUR, MAKER, 'CAXIS']]))
        expect((await ctx.historyStorage.loadActiveOrders({limit: 10})).map(o => o.id)).toEqual([1n])
        expect(await ctx.historyStorage.getCursor()).toBe('10-0000')
        //the backed amount is capped by the allowance
        expect(ctx.indexer.dispatcher.getOrder(1n).backed).toBe('700')
    })

    test('partial and full fills patch the order, store trades and archive the filled order', async () => {
        ctx.dataSource.onOrderEvent(created(1n))
        await flush()
        ctx.dataSource.loads.length = 0
        ctx.dataSource.onTradeEvent({order: 1n, taker: TAKER, maker: MAKER, soldAsset: EUR, boughtAsset: USD, sold: 800n, bought: 400n, left: 600n, ...base(20n, 101), id: 20n})
        await flush()
        const order = ctx.indexer.dispatcher.graph.getOrder(1n)
        expect(order.amount).toBe(600n)
        expect(order.status).toBe(Order.ORDER_STATUS.ACTIVE)
        expect(ctx.indexer.dispatcher.graph.lastLedger).toBe(101)
        //the maker balances changed in both assets
        expect(ctx.dataSource.loads).toEqual(expect.arrayContaining([[USD, MAKER, 'CAXIS'], [EUR, MAKER, 'CAXIS']]))

        ctx.dataSource.onTradeEvent({order: 1n, taker: TAKER, maker: MAKER, soldAsset: EUR, boughtAsset: USD, sold: 1200n, bought: 600n, left: 0n, ...base(30n, 102), id: 30n})
        await flush()
        expect(ctx.indexer.dispatcher.graph.isEmpty).toBe(true)
        const archived = await ctx.historyStorage.loadArchivedOrders({limit: 10})
        expect(archived.map(o => [o.id, o.status])).toEqual([[1n, Order.ORDER_STATUS.FILLED]])
        expect((await ctx.historyStorage.loadActiveOrders({limit: 10}))).toEqual([])
        const trades = await ctx.historyStorage.loadTrades({limit: 10})
        expect(trades.every(t => t instanceof Trade)).toBe(true)
        expect(trades.map(t => [t.id, t.left])).toEqual([[30n, 0n], [20n, 600n]])
        //backing is no longer tracked once the maker has no live orders
        expect(ctx.indexer.backing.get(MAKER, USD)).toBeUndefined()
    })

    test('mod event re-prices the order and moves it in the market vector', async () => {
        ctx.dataSource.onOrderEvent(created(1n, {price: 2n * 10n ** 18n}))
        ctx.dataSource.onOrderEvent(created(2n, {price: 3n * 10n ** 18n}))
        await flush()
        const vector = () => ctx.indexer.dispatcher.graph.sellingGraph.get(EUR).get(USD).map(o => o.id)
        expect(vector()).toEqual([1n, 2n])
        ctx.dataSource.onOrderEvent({action: 'mod', id: 1n, price: 4n * 10n ** 18n, amount: 900n, ...base(50n, 105)})
        await flush()
        expect(vector()).toEqual([2n, 1n])
        const order = ctx.indexer.dispatcher.graph.getOrder(1n)
        expect(order.price).toBe(4n * 10n ** 18n)
        expect(order.amount).toBe(900n)
        expect(order.quote).toBe(1000n)
        expect((await ctx.historyStorage.loadActiveOrders({limit: 10})).map(o => o.id)).toEqual([2n, 1n])
    })

    test('mod event with zero amount cancels and archives the order', async () => {
        ctx.dataSource.onOrderEvent(created(1n))
        await flush()
        ctx.dataSource.onOrderEvent({action: 'mod', id: 1n, price: 2n * 10n ** 18n, amount: 0n, ...base(50n, 105)})
        await flush()
        expect(ctx.indexer.dispatcher.graph.isEmpty).toBe(true)
        const archived = await ctx.historyStorage.loadArchivedOrders({limit: 10})
        expect(archived.map(o => [o.id, o.status, o.amount])).toEqual([[1n, Order.ORDER_STATUS.CANCELED, 1000n]])
    })

    test('swap events are stored in the trades log', async () => {
        ctx.dataSource.onSwapEvent({trader: TAKER, soldAsset: EUR, boughtAsset: USD, sold: 10n, bought: 5n, ...base(70n, 110), id: 70n})
        await flush()
        const [swap] = await ctx.historyStorage.loadTrades({limit: 10})
        expect(swap).toBeInstanceOf(Swap)
        expect(swap.id).toBe(70n)
        expect(ctx.indexer.dispatcher.graph.lastLedger).toBe(110)
    })

    test('a removed order id can be reused by a new order', async () => {
        ctx.dataSource.onOrderEvent(created(1n))
        await flush()
        ctx.dataSource.onOrderEvent({action: 'mod', id: 1n, price: 2n * 10n ** 18n, amount: 0n, ...base(50n, 105)})
        await flush()
        ctx.dataSource.onOrderEvent(created(1n, {...base(60n, 106), amount: 300n}))
        await flush()
        expect(ctx.indexer.dispatcher.graph.getOrder(1n).amount).toBe(300n)
        expect((await ctx.historyStorage.loadActiveOrders({limit: 10})).map(o => o.position)).toEqual([60n])
        expect((await ctx.historyStorage.loadArchivedOrders({limit: 10})).map(o => o.position)).toEqual([10n])
    })

    test('an expired order is archived as EXPIRED and replaced when a new order reuses its id', async () => {
        const now = Math.floor(Date.now() / 1000)
        ctx.dataSource.onOrderEvent(created(1n, {expires: now + 100}))
        await flush()
        expect(ctx.indexer.dispatcher.getOrder(1n).expires).toBeDefined()
        expect(ctx.indexer.expireOrders(now + 100)).toHaveLength(1)
        await flush()
        expect(ctx.indexer.dispatcher.graph.sellingGraph.get(EUR)).toBeUndefined()
        expect(ctx.indexer.backing.get(MAKER, USD)).toBeUndefined()
        expect(ctx.indexer.dispatcher.getOrders({})).toEqual([])
        expect(await ctx.historyStorage.loadActiveOrders({limit: 10})).toEqual([])
        expect((await ctx.historyStorage.loadArchivedOrders({limit: 10})).map(o => [o.position, o.status]))
            .toEqual([[10n, Order.ORDER_STATUS.EXPIRED]])
        //archived with the cursor of the last processed event
        expect(await ctx.historyStorage.getCursor()).toBe('10-0000')
        //the contract overwrites the expired entry with the new order
        ctx.dataSource.onOrderEvent(created(1n, {...base(60n, 106), amount: 300n}))
        await flush()
        expect(ctx.indexer.dispatcher.graph.getOrder(1n).amount).toBe(300n)
        expect(ctx.indexer.dispatcher.graph.isLive(1n)).toBe(true)
        expect((await ctx.historyStorage.loadActiveOrders({limit: 10})).map(o => o.position)).toEqual([60n])
        const archived = await ctx.historyStorage.loadArchivedOrders({limit: 10})
        expect(archived.map(o => [o.position, o.status])).toEqual([[10n, Order.ORDER_STATUS.EXPIRED]])
        expect(ctx.indexer.backing.get(MAKER, USD).refs).toBe(1)
    })

    test('mod event revives an expired order and moves it back to the active set', async () => {
        const now = Math.floor(Date.now() / 1000)
        ctx.dataSource.onOrderEvent(created(1n, {expires: now + 100}))
        await flush()
        ctx.indexer.expireOrders(now + 100)
        await flush()
        ctx.dataSource.onOrderEvent({action: 'mod', id: 1n, price: 2n * 10n ** 18n, amount: 500n, expires: now + 7200, ...base(50n, 105)})
        await flush()
        const order = ctx.indexer.dispatcher.graph.getOrder(1n)
        expect(order.expires).toBe(now + 7200)
        expect(ctx.indexer.dispatcher.graph.isLive(1n)).toBe(true)
        expect(ctx.indexer.dispatcher.getOrder(1n).status).toBe('ACTIVE')
        expect(ctx.indexer.dispatcher.graph.sellingGraph.get(EUR).get(USD)).toEqual([order])
        expect(ctx.indexer.backing.get(MAKER, USD).refs).toBe(1)
        expect((await ctx.historyStorage.loadActiveOrders({limit: 10})).map(o => o.id)).toEqual([1n])
        expect(await ctx.historyStorage.loadArchivedOrders({limit: 10})).toEqual([])
    })

    test('removing an expired order turns its archived record CANCELED', async () => {
        const now = Math.floor(Date.now() / 1000)
        ctx.dataSource.onOrderEvent(created(1n, {expires: now + 100}))
        await flush()
        ctx.indexer.expireOrders(now + 100)
        ctx.dataSource.onOrderEvent({action: 'mod', id: 1n, price: 2n * 10n ** 18n, amount: 0n, expires: now + 100, ...base(50n, 105)})
        await flush()
        expect(ctx.indexer.dispatcher.graph.getOrder(1n)).toBeUndefined()
        expect((await ctx.historyStorage.loadArchivedOrders({limit: 10})).map(o => [o.position, o.status]))
            .toEqual([[10n, Order.ORDER_STATUS.CANCELED]])
    })

    test('a new order reloads the owner backing of the sold asset (allowance granted in the same call)', async () => {
        ctx.dataSource.onOrderEvent(created(1n))
        await flush()
        expect(ctx.indexer.dispatcher.getOrder(1n).backed).toBe('700')
        //the second order is created with an approval raising the allowance; the record is fresh, not stale
        ctx.dataSource.backing.set(`${MAKER}|${USD}`, {balance: 5000n, authorized: true, allowance: 2000n, liveUntil: 10_000})
        ctx.dataSource.loads.length = 0
        ctx.dataSource.onOrderEvent(created(2n))
        await flush()
        expect(ctx.dataSource.loads).toEqual([[USD, MAKER, 'CAXIS']])
        expect(ctx.indexer.dispatcher.getOrder(2n).backed).toBe('1000')
        expect(ctx.indexer.backing.get(MAKER, USD).refs).toBe(2)
    })

    test('skip event reloads the maker backing and records the skip', async () => {
        ctx.dataSource.onOrderEvent(created(1n))
        await flush()
        ctx.dataSource.loads.length = 0
        ctx.dataSource.onSkipEvent({order: 1n, ...base(40n, 104)})
        await flush()
        expect(ctx.dataSource.loads).toEqual(expect.arrayContaining([[USD, MAKER, 'CAXIS'], [EUR, MAKER, 'CAXIS']]))
        expect(ctx.indexer.backing.get(MAKER, USD).skipped).toBe(base(40n).ts)
        expect(ctx.indexer.dispatcher.graph.getOrder(1n).amount).toBe(1000n)
        expect(ctx.indexer.dispatcher.graph.lastLedger).toBe(104)
    })

    test('freeze, config and refresh events update and persist the contract state', async () => {
        ctx.dataSource.onConfigEvent({safetyAdmin: MAKER, oracle: 'CORACLE', marketListingFee: 900n, minTradeSize: 10n, ...base(1n, 90)})
        ctx.dataSource.onMarketEvent({a: EUR, b: USD, ...base(2n, 91)})
        ctx.dataSource.onMarketEvent({a: EUR, b: USD, ...base(3n, 92)})
        ctx.dataSource.onFreezeEvent({frozen: true, ...base(4n, 93)})
        await flush()
        const state = ctx.indexer.contractState
        expect(state.frozen).toBe(true)
        expect(state.config).toEqual({safetyAdmin: MAKER, oracle: 'CORACLE', marketListingFee: 900n, minTradeSize: 10n})
        expect(state.getMarket(USD, EUR)).toEqual({a: EUR, b: USD, created: base(2n).ts, refreshed: base(3n).ts})
        expect(state.toJSON()).toMatchObject({frozen: true, config: {marketListingFee: '900', minTradeSize: '10'}})
        expect(await ctx.historyStorage.getCursor()).toBe('4-0000')
        expect(await ctx.historyStorage.loadContractState()).toEqual(state.snapshot())
        expect(ctx.indexer.dispatcher.graph.lastLedger).toBe(93)
    })
})

describe('Indexer replay', () => {
    test('rebuilds the graph from persisted active orders in creation order and tracks their backing', async () => {
        const dataSource = new FakeDataSource()
        const historyStorage = new InMemoryHistoryStorage()
        //persisted newest-first by the storage, positions out of id order
        await historyStorage.storeOrder(makeOrder({id: 5n, position: 30n, owner: MAKER, selling: USD, buying: EUR}), 'c1')
        await historyStorage.storeOrder(makeOrder({id: 9n, position: 10n, owner: MAKER, selling: USD, buying: EUR}), 'c2')
        await historyStorage.storeOrder(makeOrder({id: 7n, position: 20n, owner: TAKER, selling: EUR, buying: USD}), 'c3')
        const indexer = new Indexer({dataSource, historyStorage, network: 'testnet', contractAddress: 'CAXIS'})
        expect(indexer.dispatcher.ready).toBe(true)
        await indexer.init()
        try {
            expect(dataSource.initArgs.cursor).toBe('c3')
            expect([...indexer.dispatcher.graph.allOrders.keys()]).toEqual([9n, 7n, 5n])
            expect(indexer.dispatcher.getOrders({}).map(o => o.cursor)).toEqual(['10', '20', '30'])
            await flush()
            expect(indexer.dispatcher.ready).toBe(true)
            expect(new Set(dataSource.loads.map(([asset, owner]) => owner + '|' + asset))).toEqual(new Set([
                `${MAKER}|${USD}`, `${MAKER}|${EUR}`, `${TAKER}|${EUR}`, `${TAKER}|${USD}`
            ]))
            expect(indexer.backing.get(MAKER, USD).refs).toBe(2)
        } finally {
            indexer.dispose()
        }
    })

    test('restores the contract state and keeps expired orders out of the live orderbook', async () => {
        const dataSource = new FakeDataSource()
        const historyStorage = new InMemoryHistoryStorage()
        await historyStorage.storeContractState({frozen: true, markets: [{a: EUR, b: USD, created: 1, refreshed: 2}]}, 'c0')
        await historyStorage.storeOrder(makeOrder({id: 5n, position: 30n, owner: MAKER, selling: USD, buying: EUR, expires: 1_000}), 'c1')
        //expired earlier and still revivable
        await historyStorage.storeOrder(makeOrder({id: 6n, position: 20n, status: Order.ORDER_STATUS.EXPIRED, expires: 900}), 'c2')
        //expired, then its id was taken by an active order
        await historyStorage.storeOrder(makeOrder({id: 7n, position: 10n, status: Order.ORDER_STATUS.EXPIRED, expires: 800}), 'c3')
        await historyStorage.storeOrder(makeOrder({id: 7n, position: 40n, owner: MAKER, selling: USD, buying: EUR}), 'c4')
        const indexer = new Indexer({dataSource, historyStorage, network: 'testnet', contractAddress: 'CAXIS'})
        await indexer.init()
        try {
            expect(indexer.contractState.frozen).toBe(true)
            expect(indexer.contractState.getMarket(USD, EUR)).toMatchObject({refreshed: 2})
            //expired during the downtime: archived
            expect(indexer.dispatcher.graph.getOrder(5n).status).toBe(Order.ORDER_STATUS.EXPIRED)
            expect(indexer.dispatcher.graph.isLive(5n)).toBe(false)
            await flush()
            expect((await historyStorage.loadActiveOrders({limit: 10})).map(o => o.id)).toEqual([7n])
            //expired orders are kept for a revival, hidden from the API
            expect(indexer.dispatcher.graph.getOrder(6n)).toBeDefined()
            expect(indexer.dispatcher.getOrders({}).map(o => o.id)).toEqual(['7'])
            expect(indexer.dispatcher.graph.getOrder(7n).position).toBe(40n)
            expect(indexer.backing.get(MAKER, USD).refs).toBe(1)
        } finally {
            indexer.dispose()
        }
    })
})

describe('Indexer change events', () => {
    let ctx
    let changes

    beforeEach(async () => {
        ctx = await setup({recheckDelay: 0})
        changes = []
        ctx.indexer.on('order', change => changes.push([change.action, change.order.id, change.fill]))
    })

    afterEach(() => {
        ctx.indexer.dispose()
    })

    test('order lifecycle: new, fill, update, cancel', async () => {
        ctx.dataSource.onOrderEvent(created(1n))
        ctx.dataSource.onTradeEvent({order: 1n, taker: TAKER, maker: MAKER, soldAsset: EUR, boughtAsset: USD, sold: 800n, bought: 400n, left: 600n, ...base(20n, 101), id: 20n})
        ctx.dataSource.onOrderEvent({action: 'mod', id: 1n, price: 3n * 10n ** 18n, amount: 500n, ...base(30n, 102)})
        ctx.dataSource.onOrderEvent({action: 'mod', id: 1n, price: 3n * 10n ** 18n, amount: 0n, ...base(40n, 103)})
        expect(changes).toEqual([
            ['new', 1n, undefined],
            //from the maker side: delivered USD (what the taker bought), received EUR
            ['fill', 1n, {sold: 400n, bought: 800n, taker: TAKER, trade: 20n, ts: 1_700_000_020}],
            ['update', 1n, undefined],
            ['cancel', 1n, undefined]
        ])
    })

    test('a fill emptying the order is reported as filled, and the trade is emitted', async () => {
        const trades = []
        ctx.indexer.on('trade', trade => trades.push(trade))
        ctx.dataSource.onOrderEvent(created(1n))
        ctx.dataSource.onTradeEvent({order: 1n, taker: TAKER, maker: MAKER, soldAsset: EUR, boughtAsset: USD, sold: 2000n, bought: 1000n, left: 0n, ...base(20n, 101), id: 20n})
        expect(changes.map(c => c[0])).toEqual(['new', 'filled'])
        expect(trades.map(t => t.id)).toEqual([20n])
    })

    test('expiration is reported', async () => {
        ctx.indexer.dispatcher.clock = () => 1_700_000_000
        ctx.dataSource.onOrderEvent(created(1n, {expires: 1_700_000_100}))
        ctx.indexer.expireOrders(1_700_000_200)
        expect(changes.map(c => c[0])).toEqual(['new', 'expire'])
    })

    test('ledger is emitted with the first event of a new ledger (polling data source)', async () => {
        const ledgers = []
        ctx.indexer.on('ledger', ledger => ledgers.push(ledger))
        ctx.dataSource.onOrderEvent(created(1n, base(10n, 300)))
        ctx.dataSource.onOrderEvent(created(2n, base(20n, 300)))
        ctx.dataSource.onOrderEvent(created(3n, base(30n, 301)))
        expect(ledgers).toEqual([300, 301])
    })

    test('backing changes and contract changes are emitted', async () => {
        const backing = []
        const contract = []
        ctx.indexer.on('backing', e => backing.push(e))
        ctx.indexer.on('contract', e => contract.push(e.kind))
        ctx.dataSource.onOrderEvent(created(1n))
        await flush()
        expect(backing).toEqual(expect.arrayContaining([{owner: MAKER, asset: USD}, {owner: MAKER, asset: EUR}]))
        ctx.dataSource.onFreezeEvent({frozen: true, ...base(50n, 104)})
        ctx.dataSource.onMarketEvent({a: EUR, b: USD, ...base(60n, 105)})
        expect(contract).toEqual(['freeze', 'market'])
    })
})

describe('Indexer with a streaming data source', () => {
    /** Streaming fake: serves snapshots on subscription and lets tests push changes */
    class StreamingDataSource extends FakeDataSource {
        streamsBacking = true
        subscriptions = []

        async subscribeBacking(asset, owner, spender) {
            this.subscriptions.push(['+', asset, owner, spender])
            return this.backing.get(owner + '|' + asset) ?? {balance: 0n, authorized: false, allowance: 0n, liveUntil: 0}
        }

        unsubscribeBacking(asset, owner, spender) {
            this.subscriptions.push(['-', asset, owner, spender])
        }
    }

    async function streamingSetup() {
        const dataSource = new StreamingDataSource()
        dataSource.backing.set(`${MAKER}|${USD}`, {balance: 5000n, authorized: true, allowance: 700n, liveUntil: 10_000})
        dataSource.backing.set(`${MAKER}|${EUR}`, {balance: 0n, authorized: true, allowance: 0n, liveUntil: 0})
        const indexer = new Indexer({dataSource, historyStorage: new InMemoryHistoryStorage(), network: 'testnet', contractAddress: 'CAXIS'})
        await indexer.init()
        return {indexer, dataSource}
    }

    test('subscribes the makers of live orders and applies pushed changes', async () => {
        const {indexer, dataSource} = await streamingSetup()
        try {
            const backing = []
            indexer.on('backing', e => backing.push(e))
            dataSource.onOrderEvent(created(1n))
            await flush()
            expect(dataSource.subscriptions).toEqual(expect.arrayContaining([['+', USD, MAKER, 'CAXIS'], ['+', EUR, MAKER, 'CAXIS']]))
            expect(dataSource.loads).toEqual([])
            expect(indexer.backing.getBudget(MAKER, USD)).toBe(700n)

            backing.length = 0
            dataSource.onBackingEvent({owner: MAKER, asset: USD, spender: 'CAXIS', balance: 400n, authorized: true, allowance: 700n, liveUntil: 10_000, ledger: 101})
            expect(indexer.backing.getBudget(MAKER, USD)).toBe(400n)
            expect(backing).toEqual([{owner: MAKER, asset: USD}])
            //other spenders are ignored
            dataSource.onBackingEvent({owner: MAKER, asset: USD, spender: 'COTHER', balance: 1n, authorized: true, allowance: 1n, liveUntil: 0, ledger: 102})
            expect(indexer.backing.getBudget(MAKER, USD)).toBe(400n)

            //a trade does not trigger reloads: the change arrives with the stream
            dataSource.onTradeEvent({order: 1n, taker: TAKER, maker: MAKER, soldAsset: EUR, boughtAsset: USD, sold: 800n, bought: 400n, left: 600n, ...base(20n, 101), id: 20n})
            await flush()
            expect(dataSource.loads).toEqual([])

            //a removed order releases the subscriptions
            dataSource.onOrderEvent({action: 'mod', id: 1n, price: 2n * 10n ** 18n, amount: 0n, ...base(50n, 105)})
            expect(dataSource.subscriptions).toEqual(expect.arrayContaining([['-', USD, MAKER, 'CAXIS'], ['-', EUR, MAKER, 'CAXIS']]))
        } finally {
            indexer.dispose()
        }
    })

    test('watched accounts share the subscriptions of their orders', async () => {
        const {indexer, dataSource} = await streamingSetup()
        //getAccount validates the addresses
        const TRADER = Keypair.random().publicKey()
        const OWNER = Keypair.random().publicKey()
        try {
            dataSource.backing.set(`${TRADER}|${USD}`, {balance: 9n, authorized: true, allowance: 3n, liveUntil: 10_000})
            //an account without orders: every requested token is subscribed and loaded before the promise resolves
            await indexer.watchBacking(TRADER, [USD, EUR])
            expect(dataSource.subscriptions).toEqual([['+', USD, TRADER, 'CAXIS'], ['+', EUR, TRADER, 'CAXIS']])
            expect(indexer.dispatcher.getAccount(TRADER)).toMatchObject({
                orders: [],
                backing: {[USD]: {balance: '9', allowance: '3', budget: '3'}, [EUR]: {balance: '0', authorized: false}}
            })
            //a maker watched while it has orders keeps a single subscription per pair
            dataSource.onOrderEvent(created(1n, {owner: OWNER}))
            await indexer.watchBacking(OWNER, [USD, EUR, 'CXLM'])
            expect(dataSource.subscriptions.filter(([op, , owner]) => op === '+' && owner === OWNER).map(s => s[1]).sort())
                .toEqual(['CEUR', 'CUSD', 'CXLM'])
            indexer.unwatchBacking(OWNER, [USD, EUR, 'CXLM'])
            expect(dataSource.subscriptions.filter(([op, , owner]) => op === '-' && owner === OWNER).map(s => s[1])).toEqual(['CXLM'])
            expect(Object.keys(indexer.dispatcher.getAccount(OWNER).backing).sort()).toEqual([EUR, USD])
            indexer.unwatchBacking(TRADER, [USD, EUR])
            expect(dataSource.subscriptions.filter(([op, , owner]) => op === '-' && owner === TRADER).length).toBe(2)
            expect(indexer.dispatcher.getAccount(TRADER).backing).toEqual({})
        } finally {
            indexer.dispose()
        }
    })

    test('records not loaded yet are left out of the account state', async () => {
        const {indexer, dataSource} = await streamingSetup()
        const TRADER = Keypair.random().publicKey()
        try {
            let release
            dataSource.subscribeBacking = () => new Promise(resolve => release = resolve)
            const watching = indexer.watchBacking(TRADER, [USD])
            expect(indexer.dispatcher.getAccount(TRADER).backing).toEqual({})
            release({balance: 5n, authorized: true, allowance: 5n, liveUntil: 10_000})
            await watching
            expect(indexer.dispatcher.getAccount(TRADER).backing[USD].balance).toBe('5')
        } finally {
            indexer.dispose()
        }
    })

    test('ledger is emitted once per streamed ledger, after its events', async () => {
        const {indexer, dataSource} = await streamingSetup()
        try {
            const events = []
            indexer.on('ledger', ledger => events.push(['ledger', ledger]))
            indexer.on('order', ({action}) => events.push([action]))
            dataSource.onOrderEvent(created(1n, {...base(10n, 200)}))
            dataSource.onOrderEvent(created(2n, {...base(20n, 200)}))
            dataSource.onLedger(200, 1_700_000_000)
            dataSource.onLedger(201, 1_700_000_005)
            dataSource.onLedger(201, 1_700_000_005)
            expect(events).toEqual([['new'], ['new'], ['ledger', 200], ['ledger', 201]])
        } finally {
            indexer.dispose()
        }
    })

    test('the data source cursor is stored after every ledger and resumed from on restart', async () => {
        const {indexer, dataSource} = await streamingSetup()
        const historyStorage = indexer.historyStorage
        try {
            dataSource.onOrderEvent(created(1n, {...base(10n, 200), expires: 1_700_000_050}))
            expect(await historyStorage.getCursor()).toBe('10-0000')
            //a ledger without AXIS events still moves the resume point
            dataSource.cursor = '0000000000000000201-9999999999'
            dataSource.onLedger(201, 1_700_000_005)
            expect(await historyStorage.getCursor()).toBe(dataSource.cursor)
            //an unchanged cursor is not stored again
            const storeCursor = jest.spyOn(historyStorage, 'storeCursor')
            dataSource.onLedger(201, 1_700_000_005)
            expect(storeCursor).not.toHaveBeenCalled()
            //later stores (the expiration timer) never move it back to the last event cursor
            indexer.expireOrders(1_700_000_100)
            expect(await historyStorage.getCursor()).toBe(dataSource.cursor)
        } finally {
            indexer.dispose()
        }
        const restarted = new StreamingDataSource()
        const indexer2 = new Indexer({dataSource: restarted, historyStorage, network: 'testnet', contractAddress: 'CAXIS'})
        await indexer2.init()
        try {
            expect(restarted.initArgs.cursor).toBe('0000000000000000201-9999999999')
        } finally {
            indexer2.dispose()
        }
    })

    test('ledger heartbeats advance the graph and report expired allowances', async () => {
        const {indexer, dataSource} = await streamingSetup()
        try {
            dataSource.onOrderEvent(created(1n))
            await flush()
            const backing = []
            indexer.on('backing', e => backing.push(e))
            dataSource.onLedger(9_999, 1_700_000_500)
            dataSource.onLedger(10_001, 1_700_000_510)
            expect(indexer.dispatcher.graph.lastLedger).toBe(10_001)
            expect(backing).toEqual([{owner: MAKER, asset: USD}])
            expect(indexer.backing.getBudget(MAKER, USD, indexer.dispatcher.graph.lastLedger)).toBe(0n)
        } finally {
            indexer.dispose()
        }
    })
})
