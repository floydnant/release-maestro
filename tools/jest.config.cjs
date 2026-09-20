/**
 * The repository-maintenance tools are native ESM and run against Node directly. Keep them in a
 * separate Jest project so the root Nx project list does not apply application transforms.
 */
module.exports = {
    displayName: 'repository-tools',
    rootDir: __dirname,
    testEnvironment: 'node',
    testMatch: ['<rootDir>/**/*.test.mjs'],
    moduleFileExtensions: ['mjs', 'js', 'json'],
    transform: {},
    coverageDirectory: '../coverage/tools',
}
