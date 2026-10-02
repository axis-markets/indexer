const {toPair} = require('../utils/asset-pair')
const {formatDateUTC} = require('../utils/date')

/**
 * Contract-level state reported by admin and market events
 */
class ContractState {
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
    applyConfig({safetyAdmin, oracle, marketListingFee, minTradeSize}) {
        this.config = {safetyAdmin, oracle, marketListingFee, minTradeSize}
    }

    /**
     * Apply a `refresh` event: the market exists and was verified against the oracle at `ts`
     * @param {string} a - First market asset (canonical order)
     * @param {string} b - Second market asset (canonical order)
     * @param {number} ts - Event timestamp, UNIX seconds
     */
    refreshMarket(a, b, ts) {
        const key = toPair(a, b)
        const market = this.markets.get(key)
        if (market) {
            market.refreshed = ts
        } else {
            this.markets.set(key, {a, b, created: ts, refreshed: ts})
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
     * Restore the state persisted with `snapshot()`
     * @param {{frozen?: boolean, config?: ContractConfig, markets?: ContractMarket[]}} [snapshot]
     */
    restore(snapshot) {
        if (!snapshot)
            return
        this.frozen = snapshot.frozen === true
        this.config = snapshot.config && {...snapshot.config}
        this.markets.clear()
        for (const market of snapshot.markets || []) {
            this.markets.set(toPair(market.a, market.b), {...market})
        }
    }

    toJSON() {
        const res = {frozen: this.frozen}
        if (this.config) {
            res.config = {
                safetyAdmin: this.config.safetyAdmin,
                oracle: this.config.oracle,
                marketListingFee: this.config.marketListingFee.toString(),
                minTradeSize: this.config.minTradeSize.toString()
            }
        }
        res.markets = [...this.markets.values()].map(({a, b, created, refreshed}) => ({
            a,
            b,
            created: formatDateUTC(created),
            refreshed: formatDateUTC(refreshed)
        }))
        return res
    }
}

module.exports = ContractState

/**
 * @typedef {Object} ContractConfig
 * @property {string} safetyAdmin - Account allowed to freeze the contract and change its settings
 * @property {string} oracle - Price oracle contract address
 * @property {bigint} marketListingFee - Fee token amount burned to open a market
 * @property {bigint} minTradeSize - Minimum trade value in USD with 7 decimals (0 = disabled)
 */

/**
 * @typedef {Object} ContractMarket
 * @property {string} a - First market asset (canonical order)
 * @property {string} b - Second market asset (canonical order)
 * @property {number} created - First `refresh` seen for the market, UNIX seconds
 * @property {number} refreshed - Last verification against the oracle, UNIX seconds
 */
