import assert from 'node:assert/strict'
import { test } from '@jest/globals'
import { snapshotInputs } from '../fixtures/security-snapshot.mjs'
import { dependencySnapshot } from './snapshot.mjs'

const snapshot = ({ bom, documents, metadata }) => dependencySnapshot(bom, documents, metadata)

test('submits both lockfiles with directed dependency edges, npm aliases, peers, optional dependencies, and accurate scopes', () => {
    const manifests = snapshot(snapshotInputs())
    const npm = manifests['pnpm-lock.yaml']
    assert.equal(npm.file.source_location, 'pnpm-lock.yaml')
    assert.equal(npm.resolved['pkg:npm/pnpm@12.8.1'].relationship, 'direct')
    assert.deepEqual(npm.resolved['pkg:npm/%40app/ui@1.0.0'].dependencies, [
        'pkg:npm/helper@2.0.0',
        'pkg:npm/optional@3.0.0',
    ])
    assert.equal(npm.resolved['pkg:npm/helper@2.0.0'].relationship, 'indirect')
    assert.deepEqual(npm.resolved['pkg:npm/helper@2.0.0'].dependencies, [])
    assert.equal(npm.resolved['pkg:npm/test@1.0.0'].scope, 'development')
    assert.equal(npm.resolved['pkg:npm/helper@2.0.0'].scope, 'runtime')
    const cargo = manifests['apps/metadata-engine/Cargo.lock']
    assert.equal(cargo.file.source_location, 'apps/metadata-engine/Cargo.lock')
    assert.deepEqual(cargo.resolved['pkg:cargo/reader@1.0.0'].dependencies, ['pkg:cargo/macro@1.0.0'])
    assert.equal(cargo.resolved['pkg:cargo/reader@1.0.0'].relationship, 'direct')
    assert.equal(cargo.resolved['pkg:cargo/macro@1.0.0'].scope, 'development')
})

test('merges dependency edges from peer variants without duplicating package identities', () => {
    const inputs = snapshotInputs()
    inputs.documents[1].snapshots['@app/ui@1.0.0(peer@3.0.0)'] = {
        dependencies: { helper: '2.0.0' },
    }
    const npm = snapshot(inputs)['pnpm-lock.yaml']
    assert.equal(Object.keys(npm.resolved).length, 5)
    assert.deepEqual(npm.resolved['pkg:npm/%40app/ui@1.0.0'].dependencies, [
        'pkg:npm/helper@2.0.0',
        'pkg:npm/optional@3.0.0',
    ])
})

test('rejects omitted dependencies and empty ecosystem coverage rather than submitting an incomplete graph', () => {
    const inputs = snapshotInputs()
    inputs.bom.components = inputs.bom.components.filter(component => component.name !== 'helper')
    assert.throws(() => snapshot(inputs), /omitted npm:helper/)
    const empty = snapshotInputs()
    empty.bom.components = []
    empty.documents = []
    empty.metadata.resolve.nodes = []
    assert.throws(() => snapshot(empty), /Empty dependency snapshot/)
})
