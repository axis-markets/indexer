const http = require('http')
const express = require('express')
const bodyParser = require('body-parser')
const pkg = require('../../package.json')

async function initApiServer(indexer, apiPort = 8070) {
    const app = express()
    app.disable('x-powered-by')
    //allow JSON and URL-encoded requests
    app.use(bodyParser.json())
    app.use(bodyParser.urlencoded({extended: false}))

    //register API routes
    require('../routes/history-routes')(app, indexer)
    require('../routes/orderbook-routes')(app, indexer)
    require('../routes/info-routes')(app, indexer)

    //error handler
    app.use((err, req, res, next) => {
        if (err?.isBlockedByCors)
            return res.status(403).end()
        if (err) {
            console.error(err)
        }
        res.status(500).end()
    })

    //404 handler
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*')
        res.status(404).send('API endpoint was not found')
    })

    const serverPort = parseInt(apiPort, 10)
    app.set('port', serverPort)

    //create and start server
    const server = http.createServer(app)
    server.on('listening', () => console.log(`${pkg.name}@${pkg.version} API server started on ${server.address().port} port.`))
    //websocketDispatcher.init(server)
    server.listen(serverPort)
}

module.exports = {initApiServer}