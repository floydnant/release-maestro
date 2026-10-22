import { TestBed } from '@angular/core/testing'
import { BandcampFan } from '@release-maestro/core'
import { FanAvatarStackComponent, FanAvatarStackVariant } from './fan-avatar-stack.component'

const fan = (name: string, imageUrl: string | null = `https://example.com/${name}.jpg`): BandcampFan => ({
    name,
    profileUrl: `https://bandcamp.com/${name.toLowerCase().replace(/\W+/g, '')}`,
    imageUrl,
})

describe(FanAvatarStackComponent.name, () => {
    const render = (fans: BandcampFan[], variant: FanAvatarStackVariant) => {
        const fixture = TestBed.createComponent(FanAvatarStackComponent)
        fixture.componentRef.setInput('fans', fans)
        fixture.componentRef.setInput('variant', variant)
        fixture.detectChanges()
        const element: HTMLElement = fixture.nativeElement
        const stack = element.querySelector<HTMLElement>('.fan-avatar-stack')
        if (!stack) throw new Error('Fan avatar stack did not render')
        return {
            stack,
            avatars: () => element.querySelectorAll('[data-slot="avatar"]'),
            count: () => element.querySelector('[data-slot="avatar-group-count"]')?.textContent?.trim(),
            summary: () => element.querySelector('.fan-summary')?.textContent?.trim(),
        }
    }

    it('names a single buyer in the release summary', () => {
        const { stack, avatars, summary, count } = render([fan('Adam Pitts')], 'release')

        expect(summary()).toBe('Bought by Adam Pitts')
        expect(stack.getAttribute('aria-label')).toBe('Bought by Adam Pitts')
        expect(stack.getAttribute('tabindex')).toBe('0')
        expect(avatars()).toHaveLength(1)
        expect(count()).toBeUndefined()
    })

    it('counts several buyers and lists every name in the accessible name', () => {
        const { stack, summary } = render([fan('Maya'), fan('River & Rain'), fan('Adam Pitts')], 'release')

        expect(summary()).toBe('Bought by 3 fans you follow')
        expect(stack.getAttribute('aria-label')).toBe(
            'Bought by 3 fans you follow: Maya, River & Rain, and Adam Pitts',
        )
    })

    it('folds fans beyond the release limit into a count disc', () => {
        const fans = ['Ada', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus'].map(name => fan(name))
        const { stack, avatars, count } = render(fans, 'release')

        expect(avatars()).toHaveLength(4)
        expect(count()).toBe('+3')
        expect(stack.getAttribute('aria-label')).toContain('Ada, Ben, Cy, Dee, Eve, Fay, and Gus')
    })

    it('shows up to three discs on a track and no visible names', () => {
        const { stack, avatars, count, summary } = render([fan('Ada'), fan('Ben'), fan('Cy')], 'track')

        expect(avatars()).toHaveLength(3)
        expect(count()).toBeUndefined()
        expect(summary()).toBeUndefined()
        expect(stack.getAttribute('aria-label')).toBe('Bought by Ada, Ben, and Cy')

        const crowded = render([fan('Ada'), fan('Ben'), fan('Cy'), fan('Dee')], 'track')
        expect(crowded.avatars()).toHaveLength(2)
        expect(crowded.count()).toBe('+2')
    })

    it('shows an initial for a fan without a profile photo', () => {
        const release = render([fan('River & Rain', null)], 'release')
        expect(release.avatars()[0]?.querySelector('img')).toBeNull()
        expect(release.avatars()[0]?.textContent?.trim()).toBe('R')

        const track = render([fan('river & rain', null)], 'track')
        expect(track.avatars()[0]?.textContent?.trim()).toBe('R')
    })
})
