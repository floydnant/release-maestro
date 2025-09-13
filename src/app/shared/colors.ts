import type tailwindColors from 'tailwindcss/colors'
import colorsJson from '../../../colors.json'
import { LeavesConcatenated } from '../../../shared/utils/object.utils'

export const colors = {
    ...colorsJson,
} satisfies Partial<Record<keyof typeof tailwindColors, unknown>> & typeof colorsJson

export type ColorIdentifier = LeavesConcatenated<typeof colors, '-'>

export const colorFrom = (identifier: ColorIdentifier): string => {
    const [name, shade] = identifier.split('-')
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const color = (colors as any)[name as any]
    if (typeof color === 'string') return color

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    return color[shade as any]
}
