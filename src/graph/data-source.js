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
 * AXIS `skip` event: a listed order was not executed because its maker could not settle the fill (backing short of
 * it, cannot receive the taker's asset, or the transfer failed); the order is left unchanged. For `crossfill` it also
 * flags a taker order its owner cannot back or be paid for
 * @typedef {ContractEventBase} SkipEvent
 * @property {bigint} order - Skipped order id
 */

/**
 * AXIS `refresh` event: a market was checked against the price oracle (`requote`, `subsidize`, market creation)
 * @typedef {ContractEventBase} MarketRefreshEvent
 * @property {string} a - First market asset (canonical order)
 * @property {string} b - Second market asset (canonical order)
 */

/**
 * AXIS `freeze` event
 * @typedef {ContractEventBase} FreezeEvent
 * @property {boolean} frozen - Whether trading is blocked after the call
 */

/**
 * AXIS `config` event: the configuration set by the constructor, `delegate`, `set_oracle` or `set_floor`
 * @typedef {ContractEventBase} ConfigEvent
 * @property {string} safetyAdmin - Account allowed to freeze the contract and change its settings
 * @property {string} oracle - Price oracle contract address
 * @property {bigint} marketListingFee - Fee token amount burned to open a market
 * @property {bigint} minTradeSize - Minimum trade value in USD with 7 decimals (0 = disabled)
 */

/**
 * Backing of an account in a token
 * @typedef {Object} BackingRecord
 * @property {bigint} balance - Token balance
 * @property {boolean} authorized - Whether the account can send/receive the token (authorized trustline or balance entry)
 * @property {bigint} allowance - Allowance granted to the AXIS contract
 * @property {number} liveUntil - Ledger sequence the allowance lives until (0 when there is no allowance)
 */

/**
 * Backing change of a subscribed account, pushed by a streaming data source
 * @typedef {BackingRecord} BackingEvent
 * @property {string} owner - Account or contract address holding the tokens
 * @property {string} asset - Token contract address
 * @property {string} [spender] - Address the allowance is granted to
 * @property {number} ledger - Ledger the backing reflects
 */
