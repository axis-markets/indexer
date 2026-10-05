const {toPair} = require('../utils/asset-pair')
const {formatDateUTC} = require('../utils/date')

/**
 * Contract-level state reported by admin and market events
 */
class ContractState {
    /**
     * @param {string} [address] - AXIS contract address
     */
    constructor(address) {
        this.address = address
    }

    /**
     * AXIS contract address
     * @type {string|undefined}
     * @readonly
     */
    address
    /**
     * Whether trading is blocked (`trade`, `swap`, `crossfill`, `subsidize`, `requote` and order changes fail)
     * @type {boolean}
     */
    frozen = false
    /**
     * Contract configuration, undefined until the first `config` event
     * @type {ContractConfig|undefined}
     */
    config
    /**
     * Markets opened by `subsidize`, keyed by the asset pair
     * @type {Map<string, ContractMarket>}
     * @readonly
     */
    markets = new Map()

    /**
     * Apply a `freeze` event
     * @param {boolean} frozen
     */
    applyFreeze(frozen) {
        this.frozen = frozen === true
    }

    /**
     * Apply a `config` event
     * @param {ContractConfig} config
     */
    applyConfig({safetyAdmin, oracle, listingMinDays, marketListingFee, minTradeSize, ledgerTime}) {
        this.config = {safetyAdmin, oracle, listingMinDays, marketListingFee, minTradeSize, ledgerTime}
    }

    /**
     * Apply a `refresh` event: the market exists and was verified against the oracle at `ts`
     * @param {string} base - Base market asset (canonical order)
     * @param {string} quote - Quote market asset (canonical order)
     * @param {number} ts - Event timestamp, UNIX seconds
     */
    refreshMarket(base, quote, ts) {
        const key = toPair(base, quote)
        const market = this.markets.get(key)
        if (market) {
            market.refreshed = ts
        } else {
            this.markets.set(key, {base, quote, created: ts, refreshed: ts})
        }
    }

    /**
     * Market record of the asset pair, in either order
     * @param {string} asset1
     * @param {string} asset2
     * @return {ContractMarket|undefined}
     */
    getMarket(asset1, asset2) {
        return this.markets.get(toPair(asset1, asset2))
    }

    /**
     * Plain object for persistence (`HistoryStorage.storeContractState`)
     * @return {{frozen: boolean, config?: ContractConfig, markets: ContractMarket[]}}
     */
    snapshot() {
        return {
            frozen: this.frozen,
            config: this.config && {...this.config},
            markets: [...this.markets.values()].map(market => ({...market}))
        }
    }

    /**
     * Restore the state persisted with `snapshot()`. Snapshots written before the `base`/`quote` naming (`a`/`b`) are
     * accepted
     * @param {{frozen?: boolean, config?: ContractConfig, markets?: ContractMarket[]}} [snapshot]
     */
    restore(snapshot) {
        if (!snapshot)
            return
        this.frozen = snapshot.frozen === true
        this.config = snapshot.config && {...snapshot.config}
        this.markets.clear()
        for (const {a, b, base = a, quote = b, created, refreshed} of snapshot.markets || []) {
            this.markets.set(toPair(base, quote), {base, quote, created, refreshed})
        }
    }

    toJSON() {
        const res = {address: this.address, frozen: this.frozen}
        if (this.config) {
            const {safetyAdmin, oracle, listingMinDays, marketListingFee, minTradeSize, ledgerTime} = this.config
            res.config = {
                safetyAdmin,
                oracle,
                listingMinDays,
                marketListingFee: marketListingFee.toString(),
                minTradeSize: minTradeSize.toString(),
                ledgerTime
            }
        }
        res.markets = [...this.markets.values()].map(({base, quote, created, refreshed}) => ({
            base,
            quote,
            created: formatDateUTC(created),
            refreshed: formatDateUTC(refreshed)
        }))
        return res
    }
}

module.exports = ContractState

/**
 * @typedef {Object} ContractConfig
 * @property {string} safetyAdmin - Account allowed to freeze the contract and change its configuration
 * @property {string} oracle - Price oracle contract address
 * @property {number} [listingMinDays] - Days of price feeds a new market must buy (0 opens markets without a fee)
 * @property {bigint} marketListingFee - Oracle fee tokens a market creator pays to provision the price feeds
 * @property {bigint} minTradeSize - Minimum trade value in USD with 7 decimals (0 = disabled)
 * @property {number} [ledgerTime] - Expected ledger close time in seconds
 */

/**
 * @typedef {Object} ContractMarket
 * @property {string} base - Base market asset, the first of the pair in canonical order
 * @property {string} quote - Quote market asset, the second of the pair in canonical order
 * @property {number} created - First `refresh` seen for the market, UNIX seconds
 * @property {number} refreshed - Last verification against the oracle, UNIX seconds
 */
