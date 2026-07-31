/**
 * Design-system tooling tests: the token generator and the class-validation ESLint plugin.
 *
 * Separate from `apps/maestro-renderer/jest.config.ts` on purpose. That project runs the Angular
 * renderer's specs through `jest-preset-angular` in jsdom; these are plain CommonJS scripts that run
 * in Node and must not pay for an Angular transform. Both are Jest, so there is one test runner in
 * the repository — MAE-100 leaves no `node:test` in design-system tooling.
 */
module.exports = {
    displayName: 'maestro-renderer-tooling',
    rootDir: __dirname,
    testEnvironment: 'node',
    testMatch: ['<rootDir>/**/*.spec.cjs'],
    moduleFileExtensions: ['cjs', 'js', 'json'],
    // The sources under test are already CommonJS; transforming them would only add startup cost.
    transform: {},
    coverageDirectory: '../../../coverage/apps/maestro-renderer/tools',
}
