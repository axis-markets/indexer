class DataLoader {
    /**
     * @type {function}
     * @protected
     */
    onTrade
    /**
     * @type {function}
     * @protected
     */
    onOrderEvent

    /**
     * @param {DataLoaderOnTrade} onTrade
     * @param {DataLoaderOnOrderEvent} onOrderEvent
     * @virtual
     */
    listen(onTrade, onOrderEvent) {
        this.onTrade = onTrade
        this.onOrderEvent = onOrderEvent
    }

    /**
     * @virtual
     * @return {Promise}
     */
    dispose() {
    }
}

module.exports = DataLoader

/**
 * @callback DataLoaderOnTrade
 * @param {Trade} trade
 */

/**
 * @callback DataLoaderOnOrderEvent
 * @param {'created'|'updated'|'removed'} type
 * @param {Order} order
 */