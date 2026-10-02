# @axis-markets/indexer

Open-source indexer for [AXIS](https://github.com/axis-markets), a smart-contract limit-orderbook DEX on Stellar's
Soroban network. The service scans AXIS contract events, maintains the current orderbook state in memory, tracks the
backing (balance and allowance) of every order maker, archives filled and cancelled orders together with executed
trades, and exposes a read-only HTTP API.

AXIS executes trades on-chain but deliberately keeps matching off-chain, so this indexer (and any custom router built on
top of it) provides the live orderbook view that traders, apps, and analytic platforms can consume.

## Install

The indexer is intended to be embedded rather than run as a standalone app. The entry point in `src/index.js` exports an
`Indexer` class that you instantiate with your own `DataSource` and `HistoryStorage` implementations.

```bash
pnpm install @axis-markets/indexer
```

```js
const {Indexer, InMemoryHistoryStorage} = require('@axis-markets/indexer')

const indexer = new Indexer({
    dataSource,                       // your DataSource implementation — delivers AXIS contract events and ledger state
    historyStorage: new InMemoryHistoryStorage(),
    network: 'public',                // Stellar network: 'public' or 'testnet'
    contractAddress: 'C...',          // AXIS contract address
    apiPort: 8070,                    // optional; omit to disable the HTTP server
    backing: {                        // optional maker backing tracker settings (polling data sources only)
        refreshInterval: 60_000,      // stale records sweep period, ms
        staleAfter: 300_000,          // record age triggering a refresh, ms
        concurrency: 4,               // concurrent state reads
        recheckDelay: 30_000          // second read after an event-driven refresh (data source state lag), ms; 0 disables
    },
    expirationInterval: 10_000        // optional; expired orders check period, ms
})

// init() resumes from the last processed cursor, rebuilds the in-memory orderbook from
// the persisted active orders (obtained from historyStorage), then subscribes the data source to live contract events
await indexer.init()
```

## Contract model

The AXIS contract holds no user funds. An order is backed by its owner's token balance and by a standing allowance
granted to the contract. Fills are settled with `transfer_from` between maker and taker. Consequences for the indexer:

- **Order ids are `u128` hashes** of the owner and a client-chosen nonce. They are not sequential and may be reused once
  the order is gone or has expired, so the indexer orders and paginates active orders by their creation
  `position` (the event ordinal supplied by the data source), and history records are told apart by `(id, position)`.
- **Fills emit only `trade` events** carrying the maker order amount `left`; the indexer patches the order from the
  trade (`left = 0` archives it as `FILLED`). `new` creates an order, `mod` changes its amount, price and expiration
  (`amount = 0` archives it as `CANCELED`). The contract never removes or trims an order it cannot fill.
- **Expiration emits nothing.** An order whose `expires` has passed is no longer filled, but the contract keeps its
  entry: the owner can remove it or revive it with a new expiration (`mod`), and a new order may reuse its id. The
  indexer checks expirations on a timer (`expirationInterval`): an expired order leaves the live orderbook (market
  vectors, `/markets`, `/order`, backing tracking) and is archived as `EXPIRED`. The indexer keeps it in memory, and
  reloads it from the archive at startup, so that a revival moves it back to the active orders (same record), a removal
  turns the archived record `CANCELED`, and a new order under its id replaces it.
- **Skipped fills.** A listed order whose maker cannot settle the fill (backing short of it, cannot receive the taker's
  asset, or the transfer failed) is left unchanged and reported by a `skip` event. The indexer reloads the maker's
  backing and records the time of the skip on the backing of the asset the order sells (`skipped`), so routers can stop
  proposing that maker.
- **Trades and swaps have no on-chain id** their id is the event position.
- **Effective depth.** A maker can deliver at most `min(balance, allowance)` in the asset they sell, shared across all
  their orders in that asset, and only while the allowance is alive. The `BackingTracker` keeps a record per
  `(owner, asset)` for every live order (both order assets: the selling side funds the order, the buying side must be
  receivable), refreshed on order events, trades, skips and a periodic sweep, and once more `recheckDelay` after the
  latest event (the data source may serve ledger state lagging its events). Serialized orders expose `backed` (the
  order's share of the budget, split among the maker's orders selling the asset oldest first) and `backing`, with
  `backing.pending` set until that recheck confirms the latest change; expired orders are not tracked and carry neither.
  With a streaming data source (`streamsBacking`) the records are subscribed instead: the data source pushes every
  change of a tracked maker per ledger, there are no sweeps or rechecks, and a `skip` triggers one reload.
- **Contract state.** `freeze`, `config` and `refresh` events maintain `ContractState` (`indexer.contractState`): the
  frozen switch, the configuration (safety admin, oracle, listing fee, minimum trade size) and the markets opened by
  `subsidize` with the time of their last oracle check. It is persisted through `HistoryStorage.storeContractState`.

## Architecture

- **`OrderBookGraph`** — two-sided in-memory graph (`sellingGraph` / `buyingGraph`) of every live order, keyed by asset
  and sorted by price, plus the `backing` tracker. `allOrders` also holds the archived expired orders their owners can
  still revive (`isLive(id)` tells them apart; they are never served by the API).
- **`OrderBookDispatcher`** — write API for the indexer (`add`, `fill`, `modify`, `skip`, `expire`; it keeps the maker
  backing tracked for every live order) and read API for the HTTP layer (`getOrder`, `getOrders`, `getMarkets`,
  `getBacking`, `getAccount`). One balance and one allowance back every order of a maker selling the same token, so the
  serialized `backed` of an order is its share of `min(balance, allowance)` split among those orders oldest first
  (`allocateBacking`); the graph indexes orders by owner (`ordersByOwner`) for it.
- **Events** — `Indexer` is an `EventEmitter`: `order` (`{action, order, fill?}`, `action` is `new`, `fill` (partial),
  `filled`, `update`, `cancel` or `expire`; `fill` is reported from the maker's side), `trade`, `swap`, `backing`
  (`{owner, asset}`: balance, allowance, authorization or the `pending` state changed), `contract`
  (`{kind: 'freeze'|'config'|'market', market?}`) and `ledger` (once per ledger: with a streaming data source after the
  ledger's events and backing changes, otherwise with the first event of a new ledger). The Aggregator pushes them to
  WebSocket clients.
- **Watched accounts** — `indexer.watchBacking(owner, assets)` tracks the backing of an account in the given tokens
  whether or not it has orders (the Aggregator watches the traders connected to its push API in every market token), and
  resolves once the records are loaded; `unwatchBacking(owner, assets)` releases them. Watches share the reference
  counting of the orders, so a streaming data source subscribes each `(owner, asset)` pair once.
- **Pair order** — market identity uses the contract canonical order (`canonicalPair`, `compareAssets`, `toPair`
  in `src/utils/asset-pair.js`): assets sorted like Soroban `Address` values (the XDR `ScAddress` bytes), which is not
  string order. `toPair(x, y)` is `a/b` with `a` first; pair keys, `/markets` and the contract state follow it.
- **`BackingTracker`** — per `(owner, asset)` balance/allowance records with reference counting, in-flight
  deduplication, bounded concurrency and stale-record sweeps; `getBudget(owner, asset, lastLedger)` is the effective
  backing, `skipped` the time of the maker's last `skip` event in that asset. In stream mode (`stream` option, set by
  the indexer for a streaming data source) it subscribes on the first reference of a pair, unsubscribes with the last
  one, applies pushed records (`apply`) and reports allowances expiring as ledgers advance (`advanceLedger`);
  `refreshInterval`, `staleAfter`, `concurrency` and `recheckDelay` only apply to polling. `assetsOf(owner)` lists the
  tracked assets of an owner, `whenLoaded(owner, asset)` waits for an in-flight load or subscription snapshot without
  starting a new read.
- **`ContractState`** — frozen switch, configuration and markets from the `freeze`, `config` and `refresh` events.
- **`DataSource`** (abstract) — implement this interface to deliver AXIS contract events (`onOrderEvent`,
  `onTradeEvent`, `onSwapEvent`, `onSkipEvent`, `onMarketEvent`, `onFreezeEvent`, `onConfigEvent`, `onError`) and to
  read ledger state (`loadBacking(asset, owner, spender)`). Every event carries `cursor` (opaque resume token),
  `position` (monotonic ordinal), `ledger` and `ts`. A data source that follows ledger state itself sets
  `streamsBacking` and implements `subscribeBacking(asset, owner, spender)` (resolves with the current backing),
  `unsubscribeBacking`, `onBackingEvent` (`{owner, asset, spender, balance, authorized, allowance, liveUntil, ledger}`)
  and `onLedger(ledger, ts)`, e.g. `@axis-markets/rpc-data-source`. See the JSDoc typedefs in
  `src/graph/data-source.js`.
- **`HistoryStorage`** (abstract) — implement this interface to persist active orders, archived (filled, cancelled,
  expired) orders, executed trades and swaps (one log, `type` field), the contract state and the last processed event
  cursor. Order records are upserted by `(id, position)`, so a revived expired order moves back to the active set;
  `loadArchivedOrders` takes a `status` filter (the indexer reloads `EXPIRED` orders at startup). Cursors are exclusive:
  `position` for orders, `id` for trades. With a streaming data source that exposes a `cursor`, the indexer also calls
  `storeCursor(cursor)` after every processed ledger, so a quiet contract keeps a resume point within the source
  retention. `InMemoryHistoryStorage` ships as a reference implementation; production deployments are expected to use a
  durable backend (the aggregator uses SQLite).
- **HTTP API** — Express server with CORS, registered through `src/server/router.js`. The route modules are exported as
  `orderbookRoutes` and `historyRoutes` for embedding into another Express app.

## HTTP API

| Method | Path             | Description                                                                 |
|--------|------------------|-----------------------------------------------------------------------------|
| GET    | `/`              | Service status (`loading` until the maker backing is fetched), last ledger, `frozen` |
| GET    | `/markets`       | Paginated list of markets with live orders (`cursor`, `limit`)              |
| GET    | `/order/:id`     | Single active order by ID (404 when gone or expired)                        |
| GET    | `/order`         | Active orders in creation order filtered by `owner`, `asset`, `cursor`, `limit` |
| GET    | `/order-history` | Archived orders (`owner`, `pair`, `cursor`, `limit`)                        |
| GET    | `/trades`        | Recent trades and swaps (`trader`, `pair`, `cursor`, `limit`)               |
| GET    | `/backing`       | Tracked backing of a maker in a token (`owner`, `asset`), with the last `skipped` time |
| GET    | `/account/:address` | Every live order of an account (not paginated) and its loaded backing per traded or watched token |
| GET    | `/contract`      | Contract state: `frozen`, `config`, markets opened by `subsidize` with their last oracle check |

Order `status` is `ACTIVE`, `FILLED`, `CANCELED` (removed by the owner) or `EXPIRED` (passed its `expires`; archived,
and moved back to `ACTIVE` if the owner revives it). The `asset` filter of `/order` requires every listed asset to be
one of the order assets, so two assets select a pair.

Pagination: pass the `cursor` field of the last received row. Rows at or before it are skipped. Append
`?pretty_print` query param to any endpoint to receive indented JSON.

## Test

```bash
pnpm test
```

Jest runs through `node --experimental-vm-modules` (see the `test` script).

## Platform

For more details on AXIS see the platform overview at https://github.com/axis-markets.

## License

See [LICENSE](LICENSE).
