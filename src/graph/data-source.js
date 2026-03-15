/**
 * @interface
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
     * Event handler invoked on errors
     * @type {DataSourceOnError}
     */
    onError

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
     * @virtual
     * @return {Promise}
     */
    async dispose() {
    }
}

module.exports = DataSource

/**
 * @callback DataSourceOnTrade
 * @param {Trade} tradeEvent
 */

/**
 * @callback DataSourceOnOrder
 * @param {OrderEvent} orderEvent
 */

/**
 * @callback DataSourceOnError
 * @param {Error} error
 */

/**
 * @typedef {Object} OrderEvent AXIS order event
 * @property {bigint} id - Unique order ID
 * @property {'created'|'updated'|'removed'} action
 * @property {number} kind - Order type
 * @property {string} buying - Buying token address
 * @property {string} selling - Selling token address
 * @property {bigint} price - Order price
 * @property {bigint} quote - Initial selling amount
 * @property {bigint} amount - Selling amount left
 * @property {string} owner - Maker address
 * @property {number} [expires=0] - Expiration timestamp, in UNIX milliseconds
 * @property {string} cursor - Data pagination cursor
 * @property {number} ts - Event date
 */