const {NotImplemented} = require('../utils/interface-errors')

/**
 * @interface
 * @property {string} [cursor] - Resume position covering everything dispatched so far, past the last processed ledger
 *   when read from `onLedger` (optional, not declared as a field so that implementations may use an accessor): the
 *   indexer stores it per ledger, so a quiet contract keeps a resume point within the source retention
 */
class DataSource {
    /**
     * Event handler invoked on trade
     * @type {DataSourceOnTrade}
     */
    onTradeEvent
    /**
     * Event handler invoked on order changes
     * @type {DataSourceOnOrder}
     */
    onOrderEvent
    /**
     * Event handler invoked on multi-market swap
     * @type {DataSourceOnSwap}
     */
    onSwapEvent
    /**
     * Event handler invoked when a listed order was skipped because its maker could not settle the fill
     * @type {DataSourceOnSkip}
     */
    onSkipEvent
    /**
     * Event handler invoked when a market was checked against the price oracle
     * @type {DataSourceOnMarket}
     */
    onMarketEvent
    /**
     * Event handler invoked when the contract is frozen or unfrozen
     * @type {DataSourceOnFreeze}
     */
    onFreezeEvent
    /**
     * Event handler invoked when the contract configuration is set
     * @type {DataSourceOnConfig}
     */
    onConfigEvent
    /**
     * Event handler invoked when a transaction calling the AXIS contract failed (optional: only data sources that see
     * failed transactions report them). A failed call changes no state: it is recorded for diagnostics only
     * @type {DataSourceOnFailure}
     */
    onFailureEvent
    /**
     * Event handler invoked on errors
     * @type {DataSourceOnError}
     */
    onError
    /**
     * Whether the data source streams backing changes: the indexer then subscribes to the backing of every tracked
     * maker (`subscribeBacking`) and applies the pushed changes (`onBackingEvent`) instead of polling `loadBacking`
     * @type {boolean}
     * @readonly
     */
    streamsBacking = false
    /**
     * Event handler invoked when the backing of a subscribed account changes (streaming data sources)
     * @type {DataSourceOnBacking}
     */
    onBackingEvent
    /**
     * Event handler invoked after every processed ledger (streaming data sources)
     * @type {DataSourceOnLedger}
     */
    onLedger

    /**
     * Initialize data source
     * @param {'public'|'testnet'} network - Stellar network identifier
     * @param {string} contractAddress - AXIS contract address
     * @param {string} cursor - Last processed record pagination cursor
     * @return {Promise}
     * @virtual
     */
    async init(network, contractAddress, cursor) {
    }

    /**
     * Load the current backing of an account in a given token: balance, trustline authorization and the allowance
     * granted to the AXIS contract
     * @param {string} asset - Token contract address
     * @param {string} owner - Account or contract address holding the tokens
     * @param {string} [spender] - Address the allowance is granted to (AXIS contract); allowance is skipped when omitted
     * @return {Promise<BackingRecord>}
     * @abstract
     */
    async loadBacking(asset, owner, spender) {
        throw new NotImplemented()
    }

    /**
     * Start streaming the backing of an account in a token (streaming data sources, reference-counted); later changes
     * are reported via `onBackingEvent`
     * @param {string} asset - Token contract address
     * @param {string} owner - Account or contract address holding the tokens
     * @param {string} [spender] - Address the allowance is granted to (AXIS contract)
     * @return {Promise<BackingRecord>} - Current backing
     * @virtual
     */
    async subscribeBacking(asset, owner, spender) {
        throw new NotImplemented()
    }

    /**
     * Stop streaming the backing of an account in a token (releases one `subscribeBacking` reference)
     * @param {string} asset - Token contract address
     * @param {string} owner - Account or contract address holding the tokens
     * @param {string} [spender] - Address the allowance is granted to (AXIS contract)
     * @virtual
     */
    unsubscribeBacking(asset, owner, spender) {
    }

    /**
     * @virtual
     * @return {Promise}
     */
    async dispose() {
    }
}

module.exports = DataSource

/**
 * @callback DataSourceOnTrade
 * @param {TradeEvent} tradeEvent
 */

/**
 * @callback DataSourceOnOrder
 * @param {OrderEvent} orderEvent
 */

/**
 * @callback DataSourceOnSwap
 * @param {SwapEvent} swapEvent
 */

/**
 * @callback DataSourceOnSkip
 * @param {SkipEvent} skipEvent
 */

/**
 * @callback DataSourceOnMarket
 * @param {MarketRefreshEvent} marketEvent
 */

/**
 * @callback DataSourceOnFreeze
 * @param {FreezeEvent} freezeEvent
 */

/**
 * @callback DataSourceOnConfig
 * @param {ConfigEvent} configEvent
 */

/**
 * @callback DataSourceOnFailure
 * @param {FailureEvent} failureEvent
 */

/**
 * @callback DataSourceOnBacking
 * @param {BackingEvent} backingEvent
 */

/**
 * @callback DataSourceOnLedger
 * @param {number} ledger - Ledger sequence
 * @param {number} ts - Ledger close time, UNIX seconds
 */

/**
 * @callback DataSourceOnError
 * @param {Error} error
 */

/**
 * Fields shared by every contract event delivered by a data source
 * @typedef {Object} ContractEventBase
 * @property {string} cursor - Opaque data source pagination cursor (resume token)
 * @property {bigint} position - Monotonic event ordinal (ledger, transaction and event position); used for ordering and as trade id
 * @property {number} ledger - Ledger sequence the event was emitted in
 * @property {number} ts - Event timestamp, UNIX seconds
 */

/**
 * AXIS order event: `new` (an order created) or `mod` (amount/price/expiration changed outside a fill, or an expired
 * order revived; amount 0 = removed, with the price and expiration unchanged). An order reaching its expiration emits
 * nothing
 * @typedef {ContractEventBase} OrderEvent
 * @property {'new'|'mod'} action - Order change type
 * @property {bigint} id - Unique order ID (u128)
 * @property {bigint} price - Order price
 * @property {bigint} amount - Selling amount (0 for a removed order)
 * @property {number} expires - Expiration timestamp, UNIX seconds (0 = no expiration)
 * @property {string} [owner] - Maker address (`new` only)
 * @property {string} [selling] - Selling token address (`new` only)
 * @property {string} [buying] - Buying token address (`new` only)
 */

/**
 * AXIS trade event, one per fill
 * @typedef {ContractEventBase} TradeEvent
 * @property {bigint} id - Trade id (equals `position`)
 * @property {bigint} order - Maker order id
 * @property {string} taker - Trader account address
 * @property {string} maker - Maker account address
 * @property {string} soldAsset - Asset sold by the taker
 * @property {string} boughtAsset - Asset bought by the taker
 * @property {bigint} sold - Sold tokens amount
 * @property {bigint} bought - Bought tokens amount
 * @property {bigint} left - Maker order amount left after the fill (0 = removed)
 * @property {string} [fn] - AXIS function whose call emitted the event, when the data source reads the call tree
 * @property {boolean} [crossfill] - Whether this is the fill of a `crossfill` taker order, when the data source knows it
 *   from the call tree (the indexer recognizes the event pattern otherwise)
 */

/**
 * AXIS multi-market swap event
 * @typedef {ContractEventBase} SwapEvent
 * @property {bigint} id - Swap id (equals `position`)
 * @property {string} trader - Trader account address
 * @property {string} soldAsset - Sold token address
 * @property {string} boughtAsset - Bought token address
 * @property {bigint} sold - Sold tokens amount
 * @property {bigint} bought - Bought tokens amount
 */

/**
 * AXIS `skip` event: a listed order was not executed because its maker could not settle the fill: the backing left does
 * not cover it, the maker cannot receive the taker's asset (missing or deauthorized trustline), or the maker's asset
 * could not be collected. The order is left unchanged. For `crossfill` it also flags a taker order its owner cannot back
 * or be paid for. It is the only signal pointing at a party (the order owner): a payment the maker cannot be credited
 * with, or a taker who cannot pay or receive, fails the whole call instead and emits nothing
 * @typedef {ContractEventBase} SkipEvent
 * @property {bigint} order - Skipped order id
 */

/**
 * AXIS `refresh` event: a market was checked against the price oracle (`requote`, `subsidize`, market creation)
 * @typedef {ContractEventBase} MarketRefreshEvent
 * @property {string} base - Base market asset, the first of the pair in canonical order
 * @property {string} quote - Quote market asset, the second of the pair in canonical order
 */

/**
 * AXIS `freeze` event
 * @typedef {ContractEventBase} FreezeEvent
 * @property {boolean} frozen - Whether trading is blocked after the call
 */

/**
 * AXIS `config` event: the configuration set by the constructor, `delegate`, `set_oracle`, `set_floor`,
 * `set_listing_min_days` or `set_ledger_time`
 * @typedef {ContractEventBase} ConfigEvent
 * @property {string} safetyAdmin - Account allowed to freeze the contract and change its configuration
 * @property {string} oracle - Price oracle contract address
 * @property {number} listingMinDays - Days of price feeds a new market must buy (0 opens markets without a fee)
 * @property {bigint} marketListingFee - Oracle fee tokens a market creator pays to provision the price feeds (the
 *   oracle daily fee times `listingMinDays`)
 * @property {bigint} minTradeSize - Minimum trade value in USD with 7 decimals (0 = disabled)
 * @property {number} ledgerTime - Expected ledger close time in seconds, used to convert entry lifetimes into ledgers
 */

/**
 * A failed AXIS call (reported by data sources that see failed calls): the transaction failed, or a calling contract
 * caught the failure. The failure is described, never attributed: a failed payment to a maker fails the whole call
 * with the token's own error whether the payer could not pay or the maker could not be credited
 * @typedef {Object} FailureEvent
 * @property {bigint} position - Ordinal of the failure: the position of its transaction (ledger and application order,
 *   as for events) plus the index of the failed call within it
 * @property {number} ledger - Ledger sequence
 * @property {number} ts - Ledger close time, UNIX seconds
 * @property {string} txHash - Transaction hash
 * @property {string} fn - Contract function called (`trade`, `swap`, `crossfill`, `update`, ...)
 * @property {string} caller - Address authorizing the call (`trader` or `sponsor` argument), the transaction source
 *   otherwise (also for a call made through another contract)
 * @property {bigint[]} orders - Maker order ids listed by the call
 * @property {bigint} [takerOrder] - Taker order id of a `crossfill`
 * @property {string} result - Operation (or transaction) result code
 * @property {boolean} [caught] - The transaction succeeded: a calling contract caught the failed AXIS call
 * @property {'contract'|'transfer'|'resources'|'auth'|'unknown'} reason - `contract`: an AXIS error (see `error`),
 *   `transfer`: a token transfer failed (see `transfer`, either party may be at fault), `resources`: a resource limit,
 *   the refundable fee or an archived entry, `auth`: an authorization failure, `unknown`: no diagnostic events
 * @property {{contract: string, code: number, name?: string}} [error] - Contract error that failed the call
 * @property {{token: string, fn: string, from: string, to: string, amount: bigint}} [transfer] - Token transfer that
 *   failed (`transfer` or `transfer_from`), when diagnostic events show it
 */

/**
 * Backing of an account in a token
 * @typedef {Object} BackingRecord
 * @property {bigint} balance - Token balance (spendable)
 * @property {boolean} authorized - Whether the account can send/receive the token (authorized trustline or balance entry)
 * @property {bigint} allowance - Allowance granted to the AXIS contract
 * @property {number} liveUntil - Ledger sequence the allowance lives until (0 when there is no allowance)
 * @property {bigint} [headroom] - Amount the account can still receive (trustline limit minus balance and buying
 *   liabilities), undefined when unlimited or unknown
 */

/**
 * Backing change of a subscribed account, pushed by a streaming data source
 * @typedef {BackingRecord} BackingEvent
 * @property {string} owner - Account or contract address holding the tokens
 * @property {string} asset - Token contract address
 * @property {string} [spender] - Address the allowance is granted to
 * @property {number} ledger - Ledger the backing reflects
 */
