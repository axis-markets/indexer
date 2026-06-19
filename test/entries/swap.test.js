const Swap = require('../../src/entries/swap')
const {formatDateUTC} = require('../../src/utils/date')

function makeSwap(overrides = {}) {
    const s = new Swap()
    s.id = overrides.id ?? 1n
    s.trader = overrides.trader ?? 'TRADER'
    s.soldAsset = overrides.soldAsset ?? 'S'
    s.boughtAsset = overrides.boughtAsset ?? 'B'
    s.sold = overrides.sold ?? 100n
    s.bought = overrides.bought ?? 200n
    s.cursor = overrides.cursor ?? String(s.id)
    s.ts = overrides.ts ?? 1_700_000_000
    return s
}

describe('Swap.toJSON', () => {
    test('serializes BigInt fields as strings and includes approximate price and type', () => {
        const swap = makeSwap({id: 7n, sold: 100n, bought: 250n})
        const json = swap.toJSON()
        expect(json).toMatchObject({
            type: 'swap',
            id: '7',
            trader: 'TRADER',
            soldAsset: 'S',
            boughtAsset: 'B',
            sold: '100',
            bought: '250',
            price: 2.5,
            cursor: '7'
        })
    })

    test('produces a valid ISO timestamp from the swap ts', () => {
        const swap = makeSwap({ts: 1_700_000_000})
        expect(swap.toJSON().timestamp).toBe(formatDateUTC(new Date(1_700_000_000_000)))
    })

    test('JSON.stringify uses toJSON automatically', () => {
        const swap = makeSwap({id: 3n})
        const parsed = JSON.parse(JSON.stringify(swap))
        expect(parsed.id).toBe('3')
        expect(parsed.type).toBe('swap')
    })
})

describe('Swap.fromEvent', () => {
    test('creates a typed Swap from a plain event, serializing as type=swap', () => {
        const swap = Swap.fromEvent({id: 5n, trader: 'T', soldAsset: 'S', boughtAsset: 'B', sold: 10n, bought: 9n, cursor: '5', ts: 1_700_000_000})
        expect(swap).toBeInstanceOf(Swap)
        expect(swap.toJSON().type).toBe('swap')
        expect(swap.id).toBe(5n)
        expect(swap.trader).toBe('T')
    })
})
