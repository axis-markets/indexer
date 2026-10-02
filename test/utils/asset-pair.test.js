const {toPair, canonicalPair, compareAssets} = require('../../src/utils/asset-pair')

//testnet markets as reported by the contract `refresh` events: [a, b] in the contract canonical order
const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
const EURC = 'CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ'
const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const CETES = 'CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC'
const CANONICAL_MARKETS = [
    [USDC, EURC],
    [USDC, XLM],
    [USDC, CETES],
    [EURC, XLM],
    [EURC, CETES],
    [CETES, XLM]
]

describe('canonicalPair', () => {
    test.each(CANONICAL_MARKETS)('matches the contract order for %s / %s', (a, b) => {
        expect(canonicalPair(a, b)).toEqual([a, b])
        expect(canonicalPair(b, a)).toEqual([a, b])
    })

    test('differs from string order where the contract does (EURC/CETES)', () => {
        expect(EURC > CETES).toBe(true)
        expect(canonicalPair(CETES, EURC)).toEqual([EURC, CETES])
    })

    test('orders account addresses before contract addresses (ScAddress variant first)', () => {
        const account = 'GAFGQOM6RKSL3DTF4HF3G2X5SI4HLFDCFA3L7XAPLAXEFRJ2LZ5JBJHN'
        expect(canonicalPair(USDC, account)).toEqual([account, USDC])
    })

    test('falls back to string order for strings that are not addresses', () => {
        expect(canonicalPair('B', 'A')).toEqual(['A', 'B'])
    })
})

describe('compareAssets', () => {
    test('is antisymmetric and zero for equal assets', () => {
        expect(compareAssets(USDC, XLM)).toBeLessThan(0)
        expect(compareAssets(XLM, USDC)).toBeGreaterThan(0)
        expect(compareAssets(XLM, XLM)).toBe(0)
    })
})

describe('toPair', () => {
    test('puts the canonical first asset first', () => {
        expect(toPair(CETES, EURC)).toBe(`${EURC}/${CETES}`)
        expect(toPair(EURC, CETES)).toBe(`${EURC}/${CETES}`)
    })

    test('handles equal assets by returning the duplicated form', () => {
        expect(toPair('X', 'X')).toBe('X/X')
    })
})
