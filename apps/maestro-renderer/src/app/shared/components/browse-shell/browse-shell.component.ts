import { DecimalPipe } from '@angular/common'
import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core'
import { RouterLink } from '@angular/router'
import { type CatalogEntityRef } from '@release-maestro/core'
import type { BrowseStatus } from '../../browse/browse-query'
import { IconComponent } from '../icon/icon.component'

/**
 * The chrome every browse surface shares: title and count, search, the applied
 * filter chips, the availability scope, and the loading / empty / error branches.
 *
 * The rows themselves are projected. A browse surface owns its own scroller — the
 * track list virtualises a flat table, the releases grid will virtualise a grid — so
 * a shell that also owned the viewport would have to know which it was framing. The
 * seam is: the shell decides *whether* there is anything to show, and the projected
 * content decides *how* to show it.
 *
 * The two inputs are domain objects rather than a dozen primitives, which is what
 * keeps a frame this general from turning into a bag of unrelated inputs.
 */

/** One removable filter chip, already resolved from an entity id to a display name. */
export interface BrowseFilterChip extends CatalogEntityRef {
    kind: string
    /** What the chip's name is a name *of*, read out to assistive tech. */
    kindLabel: string
}

export interface BrowseShellState {
    /** Plural noun for what is being browsed, in user-facing copy: `tracks`. */
    entityLabel: string
    entityLabelSingular: string
    total: number
    status: BrowseStatus
    /** False until a first window has landed for the current query. */
    loaded: boolean
    error: string | null
}

export interface BrowseFilterState {
    search: string
    chips: BrowseFilterChip[]
}

@Component({
    selector: 'app-browse-shell',
    templateUrl: './browse-shell.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DecimalPipe, IconComponent, RouterLink],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class BrowseShellComponent {
    state = input.required<BrowseShellState>()
    filters = input.required<BrowseFilterState>()

    searchChange = output<string>()
    chipRemove = output<BrowseFilterChip>()
    clearFilters = output<void>()
    retry = output<void>()

    /**
     * A first load, as opposed to a refetch underneath rows that are already on
     * screen — a scan-driven refetch must not blank the table the user is reading.
     */
    protected isInitialLoad = computed(() => !this.state().loaded && this.state().status == 'loading')
    protected isFailed = computed(() => this.state().status == 'error' && !this.state().loaded)
    protected isEmpty = computed(() => this.state().loaded && this.state().total == 0)

    protected hasFilters = computed(() => {
        const filters = this.filters()
        return filters.chips.length > 0 || !!filters.search
    })

    /**
     * Why the result set is empty. "Your library is empty" and "your filter is too
     * narrow" look identical and have completely different next steps.
     */
    protected emptyReason = computed(() => (this.hasFilters() ? 'filtered' : 'library'))

    protected countLabel = computed(() => {
        const state = this.state()
        return state.total == 1 ? state.entityLabelSingular : state.entityLabel
    })

    /**
     * What the search box shows.
     *
     * It has to be local: the page debounces before writing the term to the URL, so
     * binding the input straight to `filters().search` would keep resetting it to a
     * value a couple of keystrokes behind, and move the caret with it. `linkedSignal`
     * still re-seeds from the URL, which is what makes back/forward and a shared link
     * restore the box.
     */
    protected searchDraft = linkedSignal(() => this.filters().search)

    protected onSearchInput(event: Event): void {
        const term = (event.target as HTMLInputElement).value
        this.searchDraft.set(term)
        this.searchChange.emit(term)
    }

    protected onClearSearch(): void {
        this.searchDraft.set('')
        this.searchChange.emit('')
    }
}
