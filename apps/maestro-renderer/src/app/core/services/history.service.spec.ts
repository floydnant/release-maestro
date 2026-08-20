import { Location } from '@angular/common'
import { TestBed } from '@angular/core/testing'
import { NavigationCancel, NavigationEnd, NavigationStart, Router } from '@angular/router'
import { Subject } from 'rxjs'
import { HistoryService } from './history.service'

/**
 * The cursor model, driven by a fake `Router` event stream.
 *
 * A fake rather than a real router because the thing under test is precisely the
 * *shape* of that stream — a popstate that names an old navigation id, a navigation
 * cancelled by a guard, a replace that reuses an entry — and half of those cannot be
 * provoked through a real router without also standing up routes, guards and a history
 * implementation to bounce off.
 */

/** Everything `HistoryService` reads off a navigation before it commits to what it was. */
interface NavigationOptions {
    /** The navigation id a popstate names, making this navigation a restore. */
    restoredFrom?: number
    replaceUrl?: boolean
    skipLocationChange?: boolean
    /** The URL the navigation settles on, when a redirect makes it differ. */
    urlAfterRedirects?: string
}

describe('HistoryService', () => {
    let events: Subject<NavigationStart | NavigationEnd | NavigationCancel>
    let service: HistoryService
    let location: { back: jest.Mock; forward: jest.Mock }
    let nextId: number
    let extras: Record<string, unknown>

    /** Begin a navigation, and answer with the id it will end or cancel under. */
    const start = (url: string, options: NavigationOptions = {}): number => {
        const id = nextId++
        extras = { replaceUrl: options.replaceUrl, skipLocationChange: options.skipLocationChange }
        const restoredState = options.restoredFrom == null ? null : { navigationId: options.restoredFrom }
        const trigger = options.restoredFrom == null ? 'imperative' : 'popstate'
        events.next(new NavigationStart(id, url, trigger, restoredState))
        return id
    }

    /** A navigation that runs to completion, answering with the id it ended under. */
    const navigate = (url: string, options: NavigationOptions = {}): number => {
        const id = start(url, options)
        events.next(new NavigationEnd(id, url, options.urlAfterRedirects ?? url))
        return id
    }

    const cancel = (id: number, url: string) => events.next(new NavigationCancel(id, url, ''))

    beforeEach(() => {
        events = new Subject()
        nextId = 1
        extras = {}
        location = { back: jest.fn(), forward: jest.fn() }

        TestBed.configureTestingModule({
            providers: [
                { provide: Router, useValue: { events, getCurrentNavigation: () => ({ extras }) } },
                { provide: Location, useValue: location },
            ],
        })
        service = TestBed.inject(HistoryService)
    })

    it('starts with nowhere to go', () => {
        expect(service.canGoBack()).toBe(false)
        expect(service.canGoForward()).toBe(false)
    })

    it('treats the first navigation as the bottom of the stack even when it redirects', () => {
        navigate('/', { urlAfterRedirects: '/home' })

        expect(service.canGoBack()).toBe(false)
        expect(service.canGoForward()).toBe(false)
    })

    it('enables Back once a second page has been pushed', () => {
        navigate('/home')
        navigate('/albums')

        expect(service.canGoBack()).toBe(true)
        expect(service.canGoForward()).toBe(false)
    })

    it('enables Forward after going back, and disables Back at the bottom', () => {
        const home = navigate('/home')
        navigate('/albums')

        navigate('/home', { restoredFrom: home })

        expect(service.canGoBack()).toBe(false)
        expect(service.canGoForward()).toBe(true)
    })

    it('walks back and forward across a three-entry stack', () => {
        const home = navigate('/home')
        const albums = navigate('/albums')
        navigate('/albums/1')

        navigate('/albums', { restoredFrom: albums })
        expect([service.canGoBack(), service.canGoForward()]).toEqual([true, true])

        navigate('/home', { restoredFrom: home })
        expect([service.canGoBack(), service.canGoForward()]).toEqual([false, true])
    })

    it('restores an entry by the id it was last written with, not only the one it was created with', () => {
        const home = navigate('/home')
        const albums = navigate('/albums')

        // Angular rewrites the restored entry's state with the restoring navigation's id.
        const restoredHome = navigate('/home', { restoredFrom: home })
        navigate('/albums', { restoredFrom: albums })
        expect(service.canGoBack()).toBe(true)

        navigate('/home', { restoredFrom: restoredHome })
        expect(service.canGoBack()).toBe(false)
        expect(service.canGoForward()).toBe(true)
    })

    it('truncates the forward entries when a new page is pushed after going back', () => {
        const home = navigate('/home')
        navigate('/albums')
        navigate('/home', { restoredFrom: home })
        expect(service.canGoForward()).toBe(true)

        navigate('/tracks')

        expect(service.canGoForward()).toBe(false)
        expect(service.canGoBack()).toBe(true)
    })

    it('does not advance the cursor for a replaceUrl navigation', () => {
        const home = navigate('/home')
        navigate('/albums')
        navigate('/albums?sort=title', { replaceUrl: true })

        navigate('/home', { restoredFrom: home })
        expect(service.canGoBack()).toBe(false)
        expect(service.canGoForward()).toBe(true)
    })

    it('does not advance the cursor for a navigation that changes no URL', () => {
        const home = navigate('/home')
        navigate('/albums')
        navigate('/albums', { skipLocationChange: true })
        // The router replaces rather than pushes when the URL already matches.
        navigate('/albums')

        navigate('/home', { restoredFrom: home })
        expect(service.canGoBack()).toBe(false)
        expect(service.canGoForward()).toBe(true)
    })

    it('leaves no entry behind for a navigation a guard bounced', () => {
        const home = navigate('/home')

        const bounced = start('/tracks')
        cancel(bounced, '/tracks')
        navigate('/import')

        expect(service.canGoBack()).toBe(true)

        navigate('/home', { restoredFrom: home })
        expect(service.canGoBack()).toBe(false)
        expect(service.canGoForward()).toBe(true)
    })

    it('follows the browser when a guard bounces a Back', () => {
        const home = navigate('/home')
        navigate('/albums')

        // The browser has already moved by the time the guard cancels, so the cursor has
        // to move with it; the redirect that follows replaces the entry it landed on.
        const bounced = start('/home', { restoredFrom: home })
        cancel(bounced, '/home')
        expect(service.canGoBack()).toBe(false)

        navigate('/import', { replaceUrl: true })
        expect(service.canGoBack()).toBe(false)
        expect(service.canGoForward()).toBe(true)
    })

    describe('driving the platform', () => {
        it('goes back and forward through Location', () => {
            const home = navigate('/home')
            navigate('/albums')

            service.back()
            expect(location.back).toHaveBeenCalled()

            navigate('/home', { restoredFrom: home })
            service.forward()
            expect(location.forward).toHaveBeenCalled()
        })

        it('does nothing when there is nowhere to go', () => {
            navigate('/home')

            service.back()
            service.forward()

            expect(location.back).not.toHaveBeenCalled()
            expect(location.forward).not.toHaveBeenCalled()
        })
    })

    describe('scroll positions', () => {
        it('offers the position the restored entry was left at', () => {
            const home = navigate('/home')

            service.registerScrollProvider(() => 1_200)
            navigate('/albums')
            expect(service.scrollRestore()).toBeNull()

            navigate('/home', { restoredFrom: home })
            expect(service.scrollRestore()).toBe(1_200)
        })

        it('offers nothing for an entry that was never scrolled', () => {
            const home = navigate('/home')
            navigate('/albums')

            navigate('/home', { restoredFrom: home })
            expect(service.scrollRestore()).toBeNull()
        })

        it('keeps a position across a replace, which stays on the same entry', () => {
            navigate('/home')

            service.registerScrollProvider(() => 800)
            navigate('/albums')
            const sorted = navigate('/albums?sort=title', { replaceUrl: true })
            service.registerScrollProvider(() => null)
            navigate('/tracks')

            navigate('/albums?sort=title', { restoredFrom: sorted })
            expect(service.scrollRestore()).toBe(800)
        })

        it('forgets the position of a forward entry a push has truncated', () => {
            const home = navigate('/home')
            service.registerScrollProvider(() => 640)
            navigate('/albums')

            navigate('/home', { restoredFrom: home })
            service.registerScrollProvider(() => null)
            const tracks = navigate('/tracks')

            navigate('/home', { restoredFrom: home })
            navigate('/tracks', { restoredFrom: tracks })
            // Index 1 is a different entry now, and 640px belonged to the old one.
            expect(service.scrollRestore()).toBeNull()
        })

        it('stops offering a position once a surface has applied it', () => {
            const home = navigate('/home')
            service.registerScrollProvider(() => 300)
            navigate('/albums')
            navigate('/home', { restoredFrom: home })

            service.consumeScrollRestore()
            expect(service.scrollRestore()).toBeNull()
        })

        it('stops reading a surface that has gone', () => {
            const home = navigate('/home')
            const unregister = service.registerScrollProvider(() => 500)
            unregister()

            navigate('/albums')
            navigate('/home', { restoredFrom: home })
            expect(service.scrollRestore()).toBeNull()
        })
    })
})
