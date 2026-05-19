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
     * Get a paginated slice of the markets list
     * @param {string[]} from - cursor pair (exclusive); pagination resumes after this entry
     * @param {number} limit
     * @return {string[][]}
     */
    range(from, limit) {
        let start = 0
        if (from) {
            const pos = this.indexOfPair(from)
            start = pos < 0 ? 0 : pos + 1
        }
        return this.markets.slice(start, start + limit)
    }

    /**
     * Insert a pair maintaining sorted order; duplicates are ignored
     * @param {string} sellingAsset
     * @param {string} buyingAsset
     */
    add(sellingAsset, buyingAsset) {
        const pair = sellingAsset.localeCompare(buyingAsset) > 0 ?
            [sellingAsset, buyingAsset] :
            [buyingAsset, sellingAsset]
        Object.freeze(pair)
        for (let i = 0; i < this.markets.length; i++) {
            const cmp = comparePairs(this.markets[i], pair)
            if (cmp === 0)
                return
            if (cmp > 0) {
                this.markets.splice(i, 0, pair)
                return
            }
        }
        this.markets.push(pair)
    }

    /**
     * Locate the index of a pair, or -1 when absent
     * @param {string[]} pair
     * @return {number}
     * @private
     */
    indexOfPair(pair) {
        return this.markets.findIndex(m => m[0] === pair[0] && m[1] === pair[1])
    }

    /**
     * @param {Iterator<AssetMarkets>} markets
     * @return {OrderbookMarketsList}
     */
    loadFromMarkets(markets) {
        for (const market of markets) {
            const {buyingAsset} = market
            for (const sellingAsset of market.counterAssets) {
                this.add(sellingAsset, buyingAsset)
            }
        }
        return this
    }
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @return {number}
 */
function comparePairs(a, b) {
    const cmp = a[0].localeCompare(b[0])
    if (cmp !== 0)
        return cmp
    return a[1].localeCompare(b[1])
}

module.exports = OrderbookMarketsList
