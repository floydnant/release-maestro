import assert from 'node:assert/strict'
import test from 'node:test'
import { isExactDependencySpecifier, isPinnedActionReference } from './verify-dependency-policy.mjs'

test('accepts exact dependency versions only', () => {
    assert.equal(isExactDependencySpecifier('1.2.3'), true)
    assert.equal(isExactDependencySpecifier('1.2.3-beta.1'), true)
    assert.equal(isExactDependencySpecifier('^1.2.3'), false)
    assert.equal(isExactDependencySpecifier('*'), false)
    assert.equal(isExactDependencySpecifier('latest'), false)
})

test('accepts immutable action references and local actions', () => {
    assert.equal(isPinnedActionReference('actions/checkout@820762786026740c76f36085b0efc47a31fe5020'), true)
    assert.equal(isPinnedActionReference('./.github/actions/setup-node'), true)
    assert.equal(isPinnedActionReference('actions/checkout@v7'), false)
})
