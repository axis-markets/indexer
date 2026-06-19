const parseHistoryEntry = require('../../src/entries/parse-history-entry')
const Trade = require('../../src/entries/trade')
const Swap = require('../../src/entries/swap')

describe('parseHistoryEntry', () => {
    test('reconstructs a Swap when the record has no maker, preserving bigint fields', () => {
        const entry = parseHistoryEntry({id: 9n, trader: 'T', soldAsset: 'S', boughtAsset: 'B', sold: 10n, bought: 9n, cursor: '9', ts: 1n})
        expect(entry).toBeInstanceOf(Swap)
        expect(entry.toJSON().type).toBe('swap')
        expect(entry.id).toBe(9n)
        expect(entry.trader).toBe('T')
    })

    test('reconstructs a Trade when the record has a maker', () => {
        const entry = parseHistoryEntry({id: 4n, order: 1n, taker: 'TK', maker: 'MK', soldAsset: 'S', boughtAsset: 'B', sold: 10n, bought: 9n, cursor: '4', ts: 1n})
        expect(entry).toBeInstanceOf(Trade)
        expect(entry.toJSON().type).toBe('trade')
        expect(entry.id).toBe(4n)
        expect(entry.maker).toBe('MK')
    })
})
