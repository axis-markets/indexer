const {Keypair, StrKey} = require('@stellar/stellar-base')
const {normalizeLimit, isValidActor, parseIdCursor} = require('../../src/utils/validation')

describe('normalizeLimit', () => {
    test('returns the limit when within range', () => {
        expect(normalizeLimit(50, 10, 100)).toBe(50)
    })

    test('falls back to the default when input is 0, missing, or null', () => {
        expect(normalizeLimit(0, 20, 200)).toBe(20)
        expect(normalizeLimit(undefined, 20, 200)).toBe(20)
        expect(normalizeLimit(null, 20, 200)).toBe(20)
        expect(normalizeLimit('', 20, 200)).toBe(20)
    })

    test('caps the value at the configured max', () => {
        expect(normalizeLimit(500, 20, 200)).toBe(200)
    })

    test('substitutes the default when the input is negative', () => {
        expect(normalizeLimit(-5, 25, 200)).toBe(25)
    })

    test('parses numeric strings', () => {
        expect(normalizeLimit('42', 10, 100)).toBe(42)
    })

    test('falls back to the default for non-numeric strings', () => {
        expect(normalizeLimit('abc', 10, 100)).toBe(10)
    })
})

describe('isValidActor', () => {
    const validPublicKey = Keypair.random().publicKey()
    const validContract = StrKey.encodeContract(Buffer.alloc(32, 1))

    test('accepts a valid Ed25519 public key', () => {
        expect(isValidActor(validPublicKey)).toBe(true)
    })

    test('accepts a valid contract address', () => {
        expect(isValidActor(validContract)).toBe(true)
    })

    test('rejects non-strings', () => {
        expect(isValidActor(null)).toBe(false)
        expect(isValidActor(undefined)).toBe(false)
        expect(isValidActor(12345)).toBe(false)
    })

    test('rejects strings of the wrong length', () => {
        expect(isValidActor('G')).toBe(false)
        expect(isValidActor(validPublicKey.slice(0, 55))).toBe(false)
        expect(isValidActor(validPublicKey + 'A')).toBe(false)
    })

    test('rejects 56-char strings that fail checksum', () => {
        expect(isValidActor('G' + 'A'.repeat(55))).toBe(false)
    })
})

describe('parseIdCursor', () => {
    test('parses positive integer strings into BigInt', () => {
        expect(parseIdCursor('42')).toBe(42n)
    })

    test('accepts BigInt input', () => {
        expect(parseIdCursor(7n)).toBe(7n)
    })

    test('rejects zero', () => {
        expect(() => parseIdCursor('0')).toThrow(/Invalid parameter: "cursor"/)
    })

    test('rejects negative values', () => {
        expect(() => parseIdCursor('-1')).toThrow(/Invalid parameter: "cursor"/)
    })

    test('rejects non-numeric input', () => {
        expect(() => parseIdCursor('not-a-number')).toThrow(/Invalid parameter: "cursor"/)
    })

    test('attaches a 400 status to the validation error', () => {
        try {
            parseIdCursor('bad')
            throw new Error('expected throw')
        } catch (e) {
            expect(e.status).toBe(400)
        }
    })
})
