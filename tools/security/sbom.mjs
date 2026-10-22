import { randomUUID } from 'node:crypto'

// Scope comes from the package managers' graphs. CycloneDX generation stays with Syft.
export const npmRuntimePackages = (documents, additionalRoots = []) => {
    const runtime = new Set()
    for (const lock of documents) {
        if (!lock.importers?.['.']?.dependencies) continue
        const importer = lock.importers['.']
        const visited = new Set()
        const visit = (name, version) => {
            const key = `${name}@${version}`
            if (visited.has(key)) return
            visited.add(key)
            const snapshot = lock.snapshots?.[key]
            if (!snapshot) throw new Error(`Missing pnpm snapshot: ${key}`)
            runtime.add(`${name}@${version.split('(')[0]}`)
            for (const [dependency, resolved] of Object.entries({
                ...snapshot.dependencies,
                ...snapshot.optionalDependencies,
            })) {
                visit(dependency, resolved)
            }
        }
        for (const [name, entry] of Object.entries({
            ...importer.dependencies,
            ...importer.optionalDependencies,
        })) {
            visit(name, entry.version)
        }
        // These renderer imports currently live in the root devDependencies section.
        for (const name of additionalRoots) {
            const entry = importer.dependencies?.[name] ?? importer.devDependencies?.[name]
            if (!entry) throw new Error(`Missing runtime dependency: ${name}`)
            visit(name, entry.version)
        }
    }
    return runtime
}

export const cargoRuntimePackages = metadata => {
    const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]))
    const visited = new Set()
    const visit = id => {
        if (visited.has(id)) return
        visited.add(id)
        const node = nodes.get(id)
        if (!node) throw new Error(`Missing Cargo resolution node: ${id}`)
        for (const dependency of node.deps) {
            if (dependency.dep_kinds.some(kind => kind.kind === null)) visit(dependency.pkg)
        }
    }
    visit(metadata.resolve.root)
    return new Set(
        metadata.packages.filter(pkg => visited.has(pkg.id)).map(pkg => `${pkg.name}@${pkg.version}`),
    )
}

export const scopeSbom = (bom, npmRuntime, cargoRuntime, electronVersion) => {
    const components = bom.components.map(component => {
        const key = `${component.name}@${component.version}`
        const runtime = component.purl?.startsWith('pkg:npm/')
            ? npmRuntime.has(key) || key === `electron@${electronVersion}`
            : cargoRuntime.has(key)
        return {
            ...component,
            properties: [
                ...(component.properties ?? []),
                { name: 'release-maestro:dependency-scope', value: runtime ? 'runtime' : 'development' },
            ],
        }
    })
    const repository = { ...bom, components }
    const runtimeComponents = components.filter(component => component.properties.at(-1).value === 'runtime')
    const refs = new Set([
        bom.metadata.component['bom-ref'],
        ...runtimeComponents.map(component => component['bom-ref']),
    ])
    const runtime = {
        ...bom,
        serialNumber: `urn:uuid:${randomUUID()}`,
        components: runtimeComponents,
        dependencies: (bom.dependencies ?? [])
            .filter(dependency => refs.has(dependency.ref))
            .map(dependency => ({
                ...dependency,
                dependsOn: (dependency.dependsOn ?? []).filter(ref => refs.has(ref)),
            })),
    }
    return { repository, runtime }
}
