class OrderbookMarketsList {
    constructor() {
        this.markets = []
    }

    /**
     * @type {string[][]}
     * @private
     */
    markets

    /**
     * Get range from markets list
     * @param {string[]} from
     * @param {number} limit
     * @return {string[][]}
     */
    range(from, limit) {
        let pos = 0
        if (from) {
            pos = this.getPosition(from)
        }
        return this.markets.slice(pos, limit)
    }

    /**
     * @param {string[]} pair
     * @return {number}
     * @private
     */
    getPosition(pair) {
        return this.markets.findIndex(m => {
            let cr = m[0].localeCompare(pair[0])
            if (cr === 0) {
                cr = m[1].localeCompare(pair[1])
            }
            return cr
        })
    }

    /**
     * @param {string} sellingAsset
     * @param {string} buyingAsset
     */
    add(sellingAsset, buyingAsset) {
        const pair = sellingAsset.localeCompare(buyingAsset) > 0 ?
            [sellingAsset, buyingAsset] :
            [buyingAsset, sellingAsset]
        Object.freeze(pair)
        const pos = this.getPosition(pair)
        if (pos < 0) {
            this.markets.push(pair)
        } else {
            this.markets.splice(pos, 0, pair)
        }
    }

    /**
     *
     * @param {Iterator<AssetMarkets>} markets
     * @return {OrderbookMarketsList}
     */
    loadFromMarkets(markets) {
        for (const market of markets) {
            const {buyingAsset} = market
            for (let sellingAsset of market.counterAssets) {
                this.add(sellingAsset, buyingAsset)
            }
        }
        return this
    }
}


module.exports = OrderbookMarketsList