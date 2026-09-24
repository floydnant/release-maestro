const { join } = require('path')
const designTokens = require('./design-tokens/tailwind.generated.json')

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [join(__dirname, 'src/**/!(*.stories|*.spec).{ts,html}')],
    theme: {
        spacing: designTokens.spacing,
        borderRadius: designTokens.borderRadius,
        opacity: designTokens.opacity,
        boxShadow: designTokens.boxShadow,
        extend: {
            colors: designTokens.colors,
            fontSize: designTokens.fontSize,
            transitionDuration: designTokens.transitionDuration,
            transitionTimingFunction: designTokens.transitionTimingFunction,
        },
    },
}
