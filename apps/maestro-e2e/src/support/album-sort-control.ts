import { expect, type Page } from '@playwright/test'

/** The album grid's sort field: a listbox combobox labelled "Sort by". */
export const albumSortField = (page: Page) => page.getByRole('combobox', { name: 'Sort by' })

/** Picks a sort field by the label the user reads, the way they would. */
export const chooseAlbumSort = async (page: Page, label: string) => {
    await albumSortField(page).click()
    await page.getByRole('option', { name: label, exact: true }).click()
}

/**
 * The trigger keeps every option label laid out invisibly to hold its width, so read the rendered
 * text rather than the DOM text.
 */
export const expectAlbumSort = (page: Page, label: string) =>
    expect(albumSortField(page)).toHaveText(label, { useInnerText: true })
