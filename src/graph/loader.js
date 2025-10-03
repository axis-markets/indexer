class DataLoader {
    /**
     * @type {function}
     * @protected
     */
    onEvent

    /**
     * @param {function} onEvent
     * @virtual
     */
    listen(onEvent) {
        this.onEvent = onEvent
    }

    /**
     * @virtual
     * @return {Promise}
     */
    dispose() {
    }
}

module.exports = DataLoader