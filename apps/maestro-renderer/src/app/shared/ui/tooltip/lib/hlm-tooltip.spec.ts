import { ChangeDetectionStrategy, Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { BrnTooltip } from '@spartan-ng/brain/tooltip'
import { HlmOverflowTooltip } from './hlm-tooltip'

@Component({
    selector: 'hlm-overflow-tooltip-test',
    imports: [HlmOverflowTooltip],
    changeDetection: ChangeDetectionStrategy.OnPush,
    // Inline overflow stands in for `truncate`: unit tests load no stylesheet.
    template: `
        <p style="overflow: hidden" hlmOverflowTooltip="A long album title">
            <span style="overflow: hidden">A long album title</span>
        </p>
    `,
})
class OverflowTooltipTest {}

/** jsdom has no layout, so give an element the box it would have in a browser. */
const layOut = (element: Element, box: { scrollWidth: number; clientWidth: number }) => {
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: box.scrollWidth })
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: box.clientWidth })
}

describe(HlmOverflowTooltip.name, () => {
    const render = () => {
        const fixture = TestBed.createComponent(OverflowTooltipTest)
        fixture.detectChanges()
        const host: HTMLElement = fixture.nativeElement.querySelector('p')
        const tooltip = fixture.debugElement.children[0].injector.get(BrnTooltip)
        const enter = () => host.dispatchEvent(new Event('pointerenter'))
        return { host, tooltip, enter }
    }

    it('stays disabled while the text fits', () => {
        const { host, tooltip, enter } = render()
        layOut(host, { scrollWidth: 120, clientWidth: 120 })
        enter()
        expect(tooltip.mutableTooltipDisabled()).toBe(true)
    })

    it('enables when a truncating descendant cuts its text off', () => {
        const { host, tooltip, enter } = render()
        layOut(host, { scrollWidth: 120, clientWidth: 120 })
        const title = host.querySelector('span')
        if (!title) throw new Error('Title span was not rendered')
        layOut(title, { scrollWidth: 240, clientWidth: 120 })
        enter()
        expect(tooltip.mutableTooltipDisabled()).toBe(false)
    })
})
