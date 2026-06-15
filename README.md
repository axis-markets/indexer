# @axis-markets/indexer

Open-source indexer for [AXIS](https://github.com/axis-markets), a smart-contract limit-orderbook DEX on Stellar's
Soroban network. The service scans AXIS contract events, maintains the current orderbook state in memory, archives
filled and cancelled orders together with executed trades, and exposes a read-only HTTP API.

AXIS executes trades on-chain but deliberately keeps matching off-chain, so this indexer (and any custom router
built on top of it) provides the live orderbook view that traders, routers, and analytics consume.

## Install

```bash
pnpm install
```

## Run

```bash
pnpm start
```

The indexer is meant to be embedded rather than run as a turnkey binary: the entry point in `src/index.js` exports an
`Indexer` class that you instantiate with your own `DataSource` and `HistoryStorage` implementations.

```js
const {Indexer, InMemoryHistoryStorage} = require('@axis-markets/indexer')

const indexer = new Indexer({
    dataSource,                       // your DataSource implementation — subscribes to AXIS contract events
    historyStorage: new InMemoryHistoryStorage(),
    network: 'public',                // Stellar network: 'public' or 'testnet'
    contractAddress: 'C...',          // AXIS contract address
    apiPort: 8070                     // optional; omit to disable the HTTP server
})

// init() resumes from the last processed cursor, rebuilds the in-memory orderbook from
// the persisted active orders, then subscribes the data source to live contract events
await indexer.init()
```

## Test

```bash
pnpm test
```

## Architecture

- **`OrderBookGraph`** — two-sided in-memory graph (`sellingGraph` / `buyingGraph`) of every active order, keyed by
  asset and indexed by price.
- **`OrderBookDispatcher`** — applies `created` / `updated` / `removed` events to the graph and serves order, market,
  and orderbook queries to the API layer.
- **`DataSource`** (abstract) — implement this interface to subscribe to AXIS contract events. The indexer wires its
  `onOrderEvent` and `onTrade` callbacks into the dispatcher and history storage.
- **`HistoryStorage`** (abstract) — implement this interface to persist active orders, archived (filled/cancelled)
  orders, executed trades, and the last processed event cursor. On restart the indexer reloads active orders to rebuild
  the orderbook and resumes the data source from the stored cursor. `InMemoryHistoryStorage` ships as a reference
  implementation; production deployments are expected to use a durable backend.
- **HTTP API** — Express server with CORS, registered through `src/server/router.js`.

## HTTP API

| Method | Path             | Description                                                   |
|--------|------------------|---------------------------------------------------------------|
| GET    | `/`              | Service status, last processed ledger, commission info        |
| GET    | `/markets`       | Paginated list of active markets (`cursor`, `limit`)          |
| GET    | `/order/:id`     | Single active order by ID                                     |
| GET    | `/order`         | Active orders filtered by `owner`, `asset`, `cursor`, `limit` |
| GET    | `/order-history` | Archived orders (`owner`, `pair`, `cursor`, `limit`)          |
| GET    | `/trades`        | Recent trades (`trader`, `pair`, `cursor`, `limit`)           |

Append `?pretty_print` query param to any endpoint to receive indented JSON.

## Platform

For background on AXIS — the on-chain orderbook contract, the proprietary backend, the SDKs, and the off-chain matching
design — see the platform overview at https://github.com/axis-markets.

## License

See [LICENSE](LICENSE).
