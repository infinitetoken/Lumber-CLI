// npm version runs this after it bumps package.json and before it commits, so the MCP Registry entry (server.json) is
// tagged with the same version as the package it points at
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const { version, mcpName } = require(join(root, 'package.json'))
const file = join(root, 'server.json')
const server = JSON.parse(readFileSync(file, 'utf8'))
if (server.name !== mcpName) throw new Error(`server.json is ${server.name}, but package.json's mcpName is ${mcpName}`)
server.version = version
for (const pkg of server.packages) pkg.version = version
writeFileSync(file, `${JSON.stringify(server, null, 2)}\n`)
