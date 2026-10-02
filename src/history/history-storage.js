const {NotImplemented} = require('../utils/interface-errors')

/**
 * @interface
 */
class HistoryStorage {
    /**
     * Store orderbook trade or swap (both share one log, told apart by the `type` field)
     * @param {Trade|Swap} trade - Trade or swap entry
     * @param {string} cursor - Last processed event pagination cursor
     * @return {Promise<void>}
     * @abstract
     */
    async storeTrade(trade, cursor) {
        throw new NotImplemented()
    }

    /**
     * Store an order: active orders replace the previous record with the same id, finalized (filled, cancelled,
     * expired) orders are archived. Records are upserted by `(id, position)`: an archived record of the same order is
     * replaced, and an expired order revived by its owner moves back from the archive to the active set.
     * Order ids are reusable once the order is gone or has expired, so the archive may hold several records with the
     * same id (told apart by the creation `position`)
     * @param {Order} order - Order entry
     * @param {string} cursor - Last processed event pagination cursor
     * @abstract
     */
    async storeOrder(order, cursor) {
        throw new NotImplemented()
    }

    /**
     * Store the contract state (`freeze`, `config`, `refresh` events). Storages that do not persist it replay the
     * contract events from the start to restore it
     * @param {{frozen: boolean, config?: ContractConfig, markets: ContractMarket[]}} state - State snapshot
     * @param {string} cursor - Last processed event pagination cursor
     * @return {Promise<void>}
     * @virtual
     */
    async storeContractState(state, cursor) {
    }

    /**
     * Load the contract state stored with `storeContractState`
     * @return {Promise<{frozen: boolean, config?: ContractConfig, markets: ContractMarket[]}|undefined>}
     * @virtual
     */
    async loadContractState() {
        return undefined
    }

    /**
     * Store the resume position of a processed ledger (streaming data sources report one after every ledger, with or
     * without AXIS events): `getCursor` returns the latest cursor passed to any store call
     * @param {string} cursor - Data source cursor past the processed ledger
     * @return {Promise<void>}
     * @virtual
     */
    async storeCursor(cursor) {
    }

    /**
     * Get last process DEX event id
     * @return {Promise<string>} - Last processed event pagination cursor
     * @abstract
     */
    async getCursor() {
        throw new NotImplemented()
    }

    /**
     * Load trades history, newest first
     * @param {{limit: number, [pair]: string, [trader]: string, [cursor]: bigint}} filter - Query filters; `cursor` is the id of the last record received (exclusive)
     * @return {Promise<Trade[]>}
     * @abstract
     */
    async loadTrades(filter) {
        throw new NotImplemented()
    }

    /**
     * Load active orders, newest first
     * @param {{limit: number, [owner]: string, [pair]: string, [cursor]: bigint}} filter - Query filters; `cursor` is the creation position of the last order received (exclusive)
     * @return {Promise<Order[]>}
     * @abstract
     */
    async loadActiveOrders(filter) {
        throw new NotImplemented()
    }

    /**
     * Load archived orders, newest first
     * @param {{limit: number, [owner]: string, [pair]: string, [status]: Order.ORDER_STATUS, [cursor]: bigint}} filter - Query filters; `cursor` is the creation position of the last order received (exclusive); `status` selects one final status (the indexer reloads `EXPIRED` orders at startup, since their owners can still revive them)
     * @return {Promise<Order[]>}
     * @abstract
     */
    async loadArchivedOrders(filter) {
        throw new NotImplemented()
    }

    /**
     * Release resources
     * @return {Promise}
     * @virtual
     */
    async dispose(){
    }
}

module.exports = HistoryStorage