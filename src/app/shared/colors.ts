import type tailwindColors from 'tailwindcss/colors'
import colorsJson from '../../../colors.json'
import { LeavesConcatenated } from './utils/object.utils'

export const colors = {
    ...colorsJson,
} satisfies Partial<Record<keyof typeof tailwindColors, unknown>> & typeof colorsJson

export type ColorIdentifier = LeavesConcatenated<typeof colors, '-'>

export const colorFrom = (identifier: ColorIdentifier): string => {
    const [name, shade] = identifier.split('-')
    const color = (colors as any)[name as any]
    if (typeof color === 'string') return color

    return color[shade as any]
}
