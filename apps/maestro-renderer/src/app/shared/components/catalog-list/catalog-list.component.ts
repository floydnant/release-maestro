import {
    afterNextRender,
    afterRenderEffect,
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    ElementRef,
    inject,
    input,
    linkedSignal,
    output,
    untracked,
    viewChild,
} from '@angular/core'
import { DecimalPipe } from '@angular/common'
import { RouterLink, type Params } from '@angular/router'
import type { BrowseWindow, CatalogEntityRef, GenreRow } from '@release-maestro/core'
import type { BrowseResult } from '../../browse/browse-query'

export interface CatalogListRow extends CatalogEntityRef {
    link: string[]
    queryParams?: Params
    counts?: Pick<GenreRow, 'songCount' | 'artistCount' | 'albumCount'>
}

const ROW_HEIGHT = 48
const OVERSCAN = 10
export const catalogWindowOffsetAt = (scrollTop: number): number =>
    Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)

/** A bounded list of entity links. The scroll container stays keyboard reachable at every window. */
@Component({
    selector: 'app-catalog-list',
    templateUrl: './catalog-list.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DecimalPipe, RouterLink],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class CatalogListComponent {
    result = input.required<BrowseResult<CatalogListRow>>()
    label = input.required<string>()
    query = input.required<unknown>()
    showCounts = input(false)
    restoreScrollTop = input<number | null>(null)
    viewportChange = output<BrowseWindow>()
    scrollRestored = output<void>()
    private viewport = viewChild.required<ElementRef<HTMLElement>>('viewport')
    private pendingFocus = linkedSignal<number | null>(() => {
        this.query()
        return null
    })
    protected activeIndex = linkedSignal(() => {
        this.query()
        return 0
    })
    protected rowHeight = ROW_HEIGHT
    protected height = computed(() => this.result().total * ROW_HEIGHT)
    protected offset = computed(() => this.result().offset * ROW_HEIGHT)

    constructor() {
        const destroyRef = inject(DestroyRef)
        afterNextRender(() => {
            const observer = new ResizeObserver(() => this.onScroll())
            observer.observe(this.viewport().nativeElement)
            destroyRef.onDestroy(() => observer.disconnect())
        })
        afterRenderEffect(() => {
            this.query()
            untracked(() => {
                if (this.restoreScrollTop() == null) this.viewport().nativeElement.scrollTop = 0
                this.onScroll()
            })
        })
        afterRenderEffect(() => {
            const restore = this.restoreScrollTop()
            const loaded = this.result().loaded
            untracked(() => {
                if (restore == null || !loaded) return
                this.viewport().nativeElement.scrollTop = restore
                this.onScroll()
                this.scrollRestored.emit()
            })
        })
        afterRenderEffect(() => {
            const index = this.pendingFocus()
            this.result()
            if (index == null) return
            const link = this.viewport().nativeElement.querySelector<HTMLElement>(`[data-index="${index}"]`)
            if (link) {
                link.focus({ preventScroll: true })
                this.pendingFocus.set(null)
            }
        })
    }

    scrollTop(): number {
        return this.viewport().nativeElement.scrollTop
    }

    protected onScroll(): void {
        const element = this.viewport().nativeElement
        this.viewportChange.emit({
            offset: catalogWindowOffsetAt(this.restoreScrollTop() ?? element.scrollTop),
            limit: Math.ceil(element.clientHeight / ROW_HEIGHT) + OVERSCAN * 2,
        })
    }

    protected onKeydown(event: KeyboardEvent): void {
        const total = this.result().total
        if (!total) return
        const current = this.activeIndex()
        const destination =
            event.key == 'ArrowDown'
                ? current + 1
                : event.key == 'ArrowUp'
                  ? current - 1
                  : event.key == 'Home'
                    ? 0
                    : event.key == 'End'
                      ? total - 1
                      : null
        if (destination == null) return
        event.preventDefault()
        const index = Math.max(0, Math.min(total - 1, destination))
        this.activeIndex.set(index)
        this.pendingFocus.set(index)
        const element = this.viewport().nativeElement
        const top = index * ROW_HEIGHT
        if (top < element.scrollTop) element.scrollTop = top
        else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
            element.scrollTop = top + ROW_HEIGHT - element.clientHeight
        }
        this.onScroll()
    }
}
