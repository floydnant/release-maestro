// Syft supplies package identities and runtime scope; package-manager graphs supply directed edges.
export const dependencySnapshot = (bom, documents, metadata) => {
    const manifest = prefix => ({
        name: prefix === 'pkg:npm/' ? 'pnpm-lock.yaml' : 'apps/metadata-engine/Cargo.lock',
        resolved: Object.fromEntries(
            bom.components
                .filter(component => component.purl?.startsWith(prefix))
                .map(component => [
                    component.purl,
                    {
                        package_url: component.purl,
                        relationship: 'indirect',
                        scope:
                            component.properties.find(
                                property => property.name === 'release-maestro:dependency-scope',
                            ).value === 'runtime'
                                ? 'runtime'
                                : 'development',
                        dependencies: [],
                    },
                ]),
        ),
    })
    const npm = manifest('pkg:npm/')
    const cargo = manifest('pkg:cargo/')
    const keys = new Map(
        bom.components.map(component => [
            `${component.purl?.startsWith('pkg:npm/') ? 'npm' : 'cargo'}:${component.name}@${component.version}`,
            component.purl,
        ]),
    )
    const purl = (ecosystem, name, version) => {
        let resolved = version.split('(')[0].replace(/^npm:/, '')
        const separator = resolved.indexOf('@', 1)
        if (ecosystem === 'npm' && separator >= 0) {
            name = resolved.slice(0, separator)
            resolved = resolved.slice(separator + 1)
        }
        const key = `${ecosystem}:${name}@${resolved}`
        if (!keys.has(key)) throw new Error(`Dependency snapshot omitted ${key}`)
        return keys.get(key)
    }
    const addEdges = (resolved, parent, children) => {
        resolved[parent].dependencies = [...new Set([...resolved[parent].dependencies, ...children])]
    }
    for (const lock of documents) {
        for (const importer of Object.values(lock.importers ?? {})) {
            for (const [name, entry] of Object.entries({
                ...importer.dependencies,
                ...importer.devDependencies,
                ...importer.optionalDependencies,
                ...importer.packageManagerDependencies,
            }))
                npm.resolved[purl('npm', name, entry.version)].relationship = 'direct'
        }
        for (const [key, snapshot] of Object.entries(lock.snapshots ?? {})) {
            const separator = key.indexOf('@', 1)
            const parent = purl('npm', key.slice(0, separator), key.slice(separator + 1))
            const children = Object.entries({
                ...snapshot.dependencies,
                ...snapshot.optionalDependencies,
            }).map(([name, version]) => purl('npm', name, version))
            addEdges(npm.resolved, parent, children)
        }
    }
    const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]))
    const cargoPurl = id => {
        const pkg = packages.get(id)
        return purl('cargo', pkg.name, pkg.version)
    }
    for (const node of metadata.resolve.nodes) {
        const children = node.deps.map(dependency => cargoPurl(dependency.pkg))
        if (node.id === metadata.resolve.root) {
            for (const child of children) cargo.resolved[child].relationship = 'direct'
        } else {
            addEdges(cargo.resolved, cargoPurl(node.id), children)
        }
    }
    for (const entry of [npm, cargo]) {
        if (!Object.keys(entry.resolved).length) throw new Error(`Empty dependency snapshot: ${entry.name}`)
        entry.file = { source_location: entry.name }
    }
    return Object.fromEntries([npm, cargo].map(entry => [entry.name, entry]))
}
