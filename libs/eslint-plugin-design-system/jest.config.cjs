/**
 * The sources are plain CommonJS and the suite drives ESLint, Tailwind and PostCSS, all of which
 * belong in Node rather than jsdom. There is no transform for the same reason: nothing here needs
 * compiling before it runs.
 */
module.exports = {
    displayName: 'eslint-plugin-design-system',
    rootDir: __dirname,
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.spec.cjs'],
    moduleFileExtensions: ['cjs', 'js', 'json'],
    transform: {},
    coverageDirectory: '../../coverage/libs/eslint-plugin-design-system',
}
