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
            avatarGroup: () => element.querySelector('[data-slot="avatar-group"]'),
            count: () => element.querySelector('[data-slot="avatar-group-count"]')?.textContent?.trim(),
            summary: () => element.querySelector('.fan-summary')?.textContent?.replace(/\s+/g, ' ').trim(),
            links: () => [...element.querySelectorAll<HTMLAnchorElement>('a')],
            focusable: () => [...element.querySelectorAll('a[href], [tabindex]')],
        }
    }

    describe('on a release', () => {
        it('names a single buyer as a link to their profile', () => {
            const { stack, avatars, summary, count, links } = render([fan('Adam Pitts')], 'release')

            expect(summary()).toBe('Bought by Adam Pitts')
            expect(links().map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
                ['Adam Pitts', 'https://bandcamp.com/adampitts'],
            ])
            expect(stack.getAttribute('role')).toBeNull()
            expect(stack.getAttribute('tabindex')).toBeNull()
            expect(avatars()).toHaveLength(1)
            expect(count()).toBeUndefined()
        })

        it('links every buyer to their own profile, in order, within one sentence', () => {
            const { summary, links } = render(
                [fan('Maya'), fan('River & Rain'), fan('Adam Pitts')],
                'release',
            )

            expect(summary()).toBe('Bought by Maya, River & Rain, and Adam Pitts')
            expect(links().map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
                ['Maya', 'https://bandcamp.com/maya'],
                ['River & Rain', 'https://bandcamp.com/riverrain'],
                ['Adam Pitts', 'https://bandcamp.com/adampitts'],
            ])
        })

        it('renders the sentence without stray spaces even where template whitespace is preserved', () => {
            TestBed.overrideComponent(FanAvatarStackComponent, { set: { preserveWhitespaces: true } })
            const { stack } = render([fan('Maya'), fan('River & Rain'), fan('Adam Pitts')], 'release')

            expect(stack.querySelector('.fan-summary')?.textContent).toBe(
                'Bought by Maya, River & Rain, and Adam Pitts',
            )
        })

        it('opens profiles outside the app as plain, keyboard-reachable anchors', () => {
            const { stack, links, focusable } = render([fan('Ada'), fan('Ben')], 'release')

            for (const link of links()) {
                expect(link.getAttribute('target')).toBe('_blank')
                expect(link.getAttribute('rel')).toBe('noopener noreferrer')
                expect(link.getAttribute('variant')).toBe('external-link')
                expect(link.hasAttribute('tabindex')).toBe(false)
                expect(link.closest('[role="img"], button, [aria-hidden="true"]')).toBeNull()
            }
            // The links are the only stops: nothing around them takes focus or hides them.
            expect(focusable()).toEqual(links())
            expect(stack.closest('[role="img"]')).toBeNull()
        })

        it('keeps the avatars decorative and out of the accessibility tree', () => {
            const { avatarGroup } = render([fan('Ada'), fan('Ben')], 'release')

            expect(avatarGroup()?.getAttribute('aria-hidden')).toBe('true')
            expect(avatarGroup()?.querySelector('a')).toBeNull()
        })

        it('folds avatars beyond the release limit into a count disc but still links every fan', () => {
            const names = ['Ada', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus']
            const { avatars, count, links, summary } = render(
                names.map(name => fan(name)),
                'release',
            )

            expect(avatars()).toHaveLength(4)
            expect(count()).toBe('+3')
            expect(summary()).toBe('Bought by Ada, Ben, Cy, Dee, Eve, Fay, and Gus')
            expect(links().map(link => link.getAttribute('href'))).toEqual(
                names.map(name => `https://bandcamp.com/${name.toLowerCase()}`),
            )
        })
    })

    describe('on a track', () => {
        it('shows up to three discs as one labelled stop with no visible names or links', () => {
            const { stack, avatars, count, summary, links } = render(
                [fan('Ada'), fan('Ben'), fan('Cy')],
                'track',
            )

            expect(avatars()).toHaveLength(3)
            expect(count()).toBeUndefined()
            expect(summary()).toBeUndefined()
            expect(links()).toHaveLength(0)
            expect(stack.getAttribute('role')).toBe('img')
            expect(stack.getAttribute('tabindex')).toBe('0')
            expect(stack.getAttribute('aria-label')).toBe('Bought by Ada, Ben, and Cy')

            const crowded = render([fan('Ada'), fan('Ben'), fan('Cy'), fan('Dee')], 'track')
            expect(crowded.avatars()).toHaveLength(2)
            expect(crowded.count()).toBe('+2')
            expect(crowded.stack.getAttribute('aria-label')).toBe('Bought by Ada, Ben, Cy, and Dee')
        })
    })

    it('shows an initial for a fan without a profile photo', () => {
        const release = render([fan('River & Rain', null)], 'release')
        expect(release.avatars()[0]?.querySelector('img')).toBeNull()
        expect(release.avatars()[0]?.textContent?.trim()).toBe('R')

        const track = render([fan('river & rain', null)], 'track')
        expect(track.avatars()[0]?.textContent?.trim()).toBe('R')
    })
})
