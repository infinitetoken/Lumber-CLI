const { version } = require('./package.json')

module.exports = require('@infinitetoken/tsconfig/tsup/cli')('src/cli.ts', {
  define: { 'process.env.LUMBER_CLI_VERSION': JSON.stringify(version) }
})
