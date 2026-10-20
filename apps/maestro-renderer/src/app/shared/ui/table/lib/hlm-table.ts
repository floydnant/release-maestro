import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: 'div[hlmTableContainer]',
    host: { 'data-slot': 'table-container' },
})
export class HlmTableContainer {
    constructor() {
        classes(() => hlm('relative w-full overflow-x-auto'))
    }
}

/**
 * Directive to apply Shadcn-like styling to a <table> element.
 */
@Directive({
    selector: 'table[hlmTable],div[hlmTable][role=grid]',
    host: { 'data-slot': 'table' },
})
export class HlmTable {
    constructor() {
        classes(() => hlm('w-full caption-bottom type-body-sm text-content-primary'))
    }
}

/**
 * Directive to apply Shadcn-like styling to a <thead> element
 * within an HlmTable context.
 */
@Directive({
    selector: 'thead[hlmTHead],thead[hlmTableHeader]',
    host: { 'data-slot': 'table-header' },
})
export class HlmTHead {
    constructor() {
        classes(() => hlm('[&_tr]:border-b [&_tr]:border-border-subtle'))
    }
}

/**
 * Directive to apply Shadcn-like styling to a <tbody> element
 * within an HlmTable context.
 */
@Directive({
    selector: 'tbody[hlmTBody],tbody[hlmTableBody]',
    host: { 'data-slot': 'table-body' },
})
export class HlmTBody {
    constructor() {
        classes(() => hlm('[&_tr:last-child]:border-0'))
    }
}

/**
 * Directive to apply Shadcn-like styling to a <tfoot> element
 * within an HlmTable context.
 */
@Directive({
    selector: 'tfoot[hlmTFoot],tfoot[hlmTableFooter]',
    host: { 'data-slot': 'table-footer' },
})
export class HlmTFoot {
    constructor() {
        classes(() =>
            hlm('border-t border-border-subtle bg-background-elevated type-label-sm [&>tr]:last:border-b-0'),
        )
    }
}

/**
 * Directive to apply Shadcn-like styling to a <tr> element
 * within an HlmTable context.
 */
@Directive({
    selector: 'tr[hlmTr],tr[hlmTableRow],[hlmTableRow][role=row]',
    host: { 'data-slot': 'table-row' },
})
export class HlmTr {
    constructor() {
        classes(() =>
            hlm(
                'border-b border-border-subtle transition-colors duration-fast ease-standard hover:bg-action-quiet-hover data-[state=selected]:bg-action-secondary has-aria-expanded:bg-background-elevated',
            ),
        )
    }
}

/**
 * Directive to apply Shadcn-like styling to a <th> element
 * within an HlmTable context.
 */
@Directive({
    selector: 'th[hlmTh],th[hlmTableHead],[hlmTableHead][role=columnheader]',
    host: { 'data-slot': 'table-head' },
})
export class HlmTh {
    constructor() {
        classes(() => hlm('h-10 px-3 text-left align-middle type-label-sm text-content-muted'))
    }
}

/**
 * Directive to apply Shadcn-like styling to a <td> element
 * within an HlmTable context.
 */
@Directive({
    selector: 'td[hlmTd],td[hlmTableCell],[hlmTableCell][role=gridcell]',
    host: { 'data-slot': 'table-cell' },
})
export class HlmTd {
    constructor() {
        classes(() => hlm('px-3 py-2 align-middle'))
    }
}

/**
 * Directive to apply Shadcn-like styling to a <caption> element
 * within an HlmTable context.
 */
@Directive({
    selector: 'caption[hlmCaption],caption[hlmTableCaption]',
    host: { 'data-slot': 'table-caption' },
})
export class HlmCaption {
    constructor() {
        classes(() => hlm('mt-4 type-body-sm text-content-muted'))
    }
}
