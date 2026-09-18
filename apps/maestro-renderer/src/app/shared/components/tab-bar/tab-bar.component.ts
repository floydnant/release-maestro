import { DecimalPipe } from '@angular/common'
import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { RouterLink, type Params } from '@angular/router'

/**
 * One tab: what it says, where it goes, and what is in it.
 *
 * The destination is a route rather than a value, because that is what makes a tab
 * bar navigation: the section a user is looking at is in the URL, so it survives a
 * reload, a Back, and a shared link. A tab set that only moved a signal would be a
 * different widget — `role="tablist"` with roving focus — not this one configured
 * differently.
 */
export interface Tab<TKey extends string = string> {
    /** Identity, compared against the bar's `active` to decide which tab is current. */
    key: TKey
    label: string
    /** Drawn beside the label, and read after it. Omitted when there is nothing to count. */
    count?: number
    /**
     * Router commands, defaulting to the current route — which is what a set of tabs
     * over one page needs, since they differ only in `queryParams`.
     */
    link?: unknown[] | string
    queryParams?: Params
}

/**
 * A row of tabs over one page's sections.
 *
 * It owns the whole treatment: the pill, its hover and focus states, the indicator
 * under the active one, and the `aria-current` that says which that is. Callers hand
 * over a list and the key of the section they are showing; where the tabs lead and
 * what is under them stays theirs.
 *
 * The indicator is a pseudo-element below the box rather than a bottom border on it,
 * so the hover pill can be fully rounded without bending the bar at its corners.
 *
 * `TKey` ties `active` to the keys actually on offer, so a section the bar cannot
 * show is a compile error rather than a bar with nothing marked current.
 */
@Component({
    selector: 'app-tab-bar',
    templateUrl: './tab-bar.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DecimalPipe, RouterLink],
    host: {
        role: 'navigation',
        class: 'flex flex-wrap items-center gap-1',
        '[attr.aria-label]': 'label()',
    },
})
export class TabBarComponent<TKey extends string = string> {
    tabs = input.required<Tab<TKey>[]>()
    /**
     * The key of the section on screen.
     *
     * `NoInfer` so `TKey` is fixed by the list: without it a key that is on no tab
     * widens the parameter to include itself, and the bar renders with nothing current
     * rather than failing to compile.
     */
    active = input.required<NoInfer<TKey>>()
    /** What this set of tabs is a set of, read out to assistive tech: `Genre sections`. */
    label = input.required<string>()
    /**
     * Whether moving between tabs replaces the current history entry.
     *
     * True by default: four sections of one page are one place, and pushing an entry
     * per tab makes Back walk them one at a time instead of leaving the page.
     */
    replaceUrl = input(true)
}
