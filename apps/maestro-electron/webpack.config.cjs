const { join } = require('node:path')
const { readFileSync, writeFileSync } = require('node:fs')

module.exports = (config, { normalizedOptions }) => {
    config.context = join(__dirname, '../..')

    if (normalizedOptions.generatePackageJson) {
        // Nx's generated manifest defaults to 0.0.1 in this integrated workspace.
        const manifestPath = join(normalizedOptions.outputPath, 'package.json')
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        const rootManifest = JSON.parse(readFileSync(join(config.context, 'package.json'), 'utf8'))
        manifest.version = rootManifest.version
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    }

    for (const rule of config.module?.rules ?? []) {
        if (rule.loader?.includes('ts-loader')) {
            rule.options = {
                ...rule.options,
                context: config.context,
                happyPackMode: true,
            }
        }
    }

    return config
}
