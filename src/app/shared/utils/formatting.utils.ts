import { entriesOf } from '../../../../shared/utils/object.utils'

export const formatDuration = (duration: number): string => {
    // If the duration is longer than 10 hours, its probably in milliseconds
    if (duration > 3600 * 10) {
        duration = duration / 1000
    }

    let str = ''

    const hours = Math.floor(duration / 3600) || 0
    if (hours) str += hours + ':'

    const minutes = Math.floor((duration % 3600) / 60) || 0
    if (hours) str += minutes.toString().padStart(2, '0')
    else str += minutes

    const seconds = Math.floor(duration % 60) || 0
    str += ':' + seconds.toString().padStart(2, '0')

    return str
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
/** to millis i.e. `<unit> * <factor> = milliseconds` */
const conversionFactorMap = {
    year: 24 * 60 * 60 * 1000 * 365,
    month: (24 * 60 * 60 * 1000 * 365) / 12,
    week: 24 * 60 * 60 * 1000 * 7,
    day: 24 * 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    minute: 60 * 1000,
    second: 1000,
} satisfies Partial<Record<Intl.RelativeTimeFormatUnit, number>>
const conversionFactorEntries = entriesOf(conversionFactorMap)

export const formatDateRelative = (date: Date, referenceDate: Date = new Date()): string => {
    const difference = date.valueOf() - referenceDate.valueOf()

    // Get the unit that is the most significant
    // i.e. the first unit where the difference is greater than the conversion factor to millis
    // or second if the difference is less than a second
    const [unit, conversionFactor] = conversionFactorEntries.find(([, conversionFactor]) => {
        return Math.abs(difference) > conversionFactor
    }) || ['second', 1000]

    // The difference in the unit we previously selected
    const roundedDifference = Math.round(difference / conversionFactor)

    return relativeTimeFormatter.format(roundedDifference, unit)
}
