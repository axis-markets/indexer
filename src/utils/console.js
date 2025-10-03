const originalLog = console.log.bind(console)
const originalError = console.error.bind(console)
const originalWarn = console.warn.bind(console)

function now() {
    return `[${new Date().toISOString().replace(/\.\d+Z$/, '').replace('T', ' ')}]`
}

console.log = function (...args) {
    originalLog(now(), ...args)
}

console.error = function (...args) {
    const ts = now()
    originalError(ts, ...args)
}

console.warn = function (...args) {
    const ts = now()
    originalWarn(ts, ...args)
}