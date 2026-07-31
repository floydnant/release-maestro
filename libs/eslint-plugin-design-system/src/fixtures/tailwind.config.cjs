/*
 * The Tailwind config the corpus validates against. Not the renderer's — the plugin is standalone
 * and its tests must be too, or the suite starts failing for reasons that live in another project.
 *
 * What it does mirror is the *shape* that makes the rule necessary: `spacing`, `borderRadius`,
 * `boxShadow` and `opacity` are **replaced** rather than extended, and none of the replacements
 * carries a `DEFAULT` key. That is why a bare `rounded` and an off-scale `max-h-72` emit nothing
 * while still looking like perfectly ordinary Tailwind, and it is the case that decided MAE-100.
 */
const plugin = require('tailwindcss/plugin')

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [],
    theme: {
        spacing: {
            0: '0px',
            px: '1px',
            0.5: '0.125rem',
            1: '0.25rem',
            1.5: '0.375rem',
            2: '0.5rem',
            2.5: '0.625rem',
            3: '0.75rem',
            4: '1rem',
            5: '1.25rem',
            6: '1.5rem',
            8: '2rem',
            10: '2.5rem',
            12: '3rem',
            16: '4rem',
            22: '5.5rem',
            24: '6rem',
            32: '8rem',
            52: '13rem',
            64: '16rem',
        },
        borderRadius: {
            none: '0px',
            sm: '0.25rem',
            md: '0.375rem',
            lg: '0.5rem',
            xl: '0.75rem',
            full: '9999px',
        },
        boxShadow: {
            sm: '0 1px 2px rgb(0 0 0 / 0.3)',
            md: '0 4px 8px rgb(0 0 0 / 0.3)',
            lg: '0 12px 24px rgb(0 0 0 / 0.4)',
            focus: '0 0 0 3px rgb(80 140 255 / 0.4)',
            'success-glow': '0 0 12px rgb(60 200 120 / 0.4)',
        },
        opacity: { 0: '0', 30: '0.3', 50: '0.5', 70: '0.7', 100: '1' },
        extend: {
            colors: {
                background: { canvas: 'var(--color-background-canvas)', surface: 'var(--color-background-surface)' },
                content: { primary: 'var(--color-content-primary)', muted: 'var(--color-content-muted)' },
                border: { subtle: 'var(--color-border-subtle)', focus: 'var(--color-border-focus)' },
                status: { 'info-background': 'var(--color-status-info-background)' },
            },
        },
    },
    plugins: [
        require('@tailwindcss/container-queries'),
        plugin(({ addVariant }) => {
            addVariant('not-hover', '@media (hover: hover) { &:not( :hover, :focus-visible ) }')
        }),
        plugin(({ addUtilities }) => {
            addUtilities({
                '.glass': { 'backdrop-filter': 'blur(16px)' },
                '.wrap-nicely': { 'overflow-wrap': 'break-word', hyphens: 'auto' },
                '.child-focus-ring': { '&:has(:focus-visible)': { outline: '2px solid' } },
            })
        }),
    ],
}
