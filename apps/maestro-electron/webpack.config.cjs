const { join } = require('node:path')

module.exports = (config) => {
    config.context = join(__dirname, '../..')

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
