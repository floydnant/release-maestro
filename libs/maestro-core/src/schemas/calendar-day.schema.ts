import z from 'zod'

/** A calendar date without a time or timezone, encoded as YYYY-MM-DD. */
export const calendarDaySchema = z.iso.date().brand<'CalendarDay'>()
export type CalendarDay = z.infer<typeof calendarDaySchema>
