// noble ships only ES modules, which Jest can't require on the Node CI runs (22), so ts-jest compiles them as it does
// the CLI's own source (allowJs), and transformIgnorePatterns lets it reach into node_modules for them
module.exports = require('@infinitetoken/jest-config/node')({
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  tsconfig: { allowJs: true },
  overrides: {
    transform: { '^.+\\.[tj]s$': [require.resolve('ts-jest'), { tsconfig: { module: 'CommonJS', moduleResolution: 'node', ignoreDeprecations: '5.0', types: ['jest', 'node'], allowJs: true } }] },
    transformIgnorePatterns: ['/node_modules/(?!@noble/)']
  }
})
