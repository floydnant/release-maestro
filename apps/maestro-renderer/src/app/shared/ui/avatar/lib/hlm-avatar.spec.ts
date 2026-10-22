import { ChangeDetectionStrategy, Component, ElementRef, signal, viewChild } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { HlmAvatarImage, HlmAvatarImports } from '../index'

@Component({
    selector: 'hlm-avatar-host',
    imports: [HlmAvatarImports],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div hlmAvatarGroup>
            <hlm-avatar [size]="size()">
                <img hlmAvatarImage src="https://example.com/fan.jpg" alt="" />
                <span hlmAvatarFallback>AP</span>
            </hlm-avatar>
            <span hlmAvatarGroupCount>+2</span>
        </div>
    `,
})
class AvatarHost {
    readonly size = signal<'xs' | 'sm' | 'default' | 'lg'>('xs')
    /** Held while unprojected, so the test can report its load outcome. */
    readonly image = viewChild.required(HlmAvatarImage, { read: ElementRef<HTMLImageElement> })
}

describe('HlmAvatar', () => {
    const render = () => {
        const fixture = TestBed.createComponent(AvatarHost)
        fixture.detectChanges()
        const element: HTMLElement = fixture.nativeElement
        const report = (outcome: 'load' | 'error') => {
            fixture.componentInstance.image().nativeElement.dispatchEvent(new Event(outcome))
            fixture.detectChanges()
        }
        return { fixture, element, report }
    }

    it('shows the fallback until the image loads, then the image', () => {
        const { element, report } = render()
        expect(element.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('AP')
        expect(element.querySelector('[data-slot="avatar"] img')).toBeNull()

        report('load')

        expect(element.querySelector('[data-slot="avatar"] img')).not.toBeNull()
        expect(element.querySelector('[data-slot="avatar-fallback"]')).toBeNull()
    })

    it('returns to the fallback when the image fails to load', () => {
        const { element, report } = render()
        report('load')
        report('error')

        expect(element.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('AP')
        expect(element.querySelector('[data-slot="avatar"] img')).toBeNull()
    })

    it('sizes the avatar from its size input', () => {
        const { fixture, element } = render()
        const avatar = element.querySelector<HTMLElement>('[data-slot="avatar"]')
        expect(avatar?.dataset['size']).toBe('xs')
        expect(avatar?.classList).toContain('size-5')

        fixture.componentInstance.size.set('lg')
        fixture.detectChanges()

        expect(avatar?.dataset['size']).toBe('lg')
        expect(avatar?.classList).toContain('size-10')
        expect(avatar?.classList).not.toContain('size-5')
    })
})
