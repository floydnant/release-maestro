import { Component, computed, ElementRef, HostListener, inject, signal, viewChildren } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { RouterLink } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { from } from 'rxjs'
import { z } from 'zod'
import { ElectronService } from '../core/services'
import { IntersectionDirective } from '../shared/directives/intersection.directive'
import { SafePipe } from '../shared/pipes/safe.pipe'

const bandcampEmailEntry = z.object({
    messageId: z.string(),
    subject: z.string(),
    dateReceived: z.string(),
    sender: z.string(),
    plainBody: z.string(),
    isRead: z.boolean({ coerce: true }),
    bandcampEmailType: z.enum([
        'NEW_MESSAGE',
        'NEW_RELEASE',
        'SHIPMENT_NOTIFICATION',
        'FANS_BOUGHT_NEW_STUFF',
        'THANK_YOU',
        'LISTENING_PARTY',
        'OTHER',
    ]),
    musicLinks: z.string().array().optional(),
    links: z.string().array().optional(),
    release: z.object({ type: z.enum(['album', 'track']), releaseId: z.string() }).nullish(),
})

type BandcampEmail = z.infer<typeof bandcampEmailEntry>

@Component({
    selector: 'app-detail',
    templateUrl: './detail.component.html',
    styleUrls: ['./detail.component.css'],
    imports: [RouterLink, TranslateModule, SafePipe, IntersectionDirective],
})
export class DetailComponent {
    electronService = inject(ElectronService)

    constructor() {}

    bandcampEmails = toSignal(
        from(
            this.electronService.fsPromises
                .readFile(this.electronService.env.EMAIL_JSON_PATH, 'utf-8')
                .then(data => {
                    return bandcampEmailEntry
                        .array()
                        .parse(JSON.parse(data))
                        .map(email => ({
                            ...email,
                            parsedDate: new Date(email.dateReceived),
                            plainBody: email.plainBody
                                .replace(/\s*\?\s*/g, '\n')
                                .replace(/�/g, '')
                                .replace(
                                    /((Unfollow|Unsubscribe)( [\w-\.]+)*)(?=\n)/i,
                                    `<a href="${email.links?.find(link => link.includes('fan_unsubscribe'))}">$1</a>`,
                                )
                                .trim()
                                .replace(/\n/g, '<br>'),
                            links: email.links?.filter(
                                link =>
                                    !link.includes('f4.bcbits.com') &&
                                    !link.includes('fan_unsubscribe') &&
                                    !link.includes('https://bandcamp.com/img/email/bc-logo-small-2.gif'),
                            ),
                            imageUrl: email.links?.find(link => link.includes('f4.bcbits.com')),
                            iframeUrl: `https://bandcamp.com/EmbeddedPlayer/${email.release?.type}=${email.release?.releaseId}/size=large/bgcol=999999/linkcol=0687f5`,
                        }))
                        .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime())
                })
                .catch(err => {
                    console.error('Failed to load bandcamp emails:', err)
                }),
        ),
    )
    unreadEmailsCount = computed(() => {
        return this.bandcampEmails()?.filter(email => !email.isRead).length
    })

    emailEntries = viewChildren<ElementRef<HTMLElement>>('emailEntry')
    currentEmailIndex = signal(0)
    furthestScrolledIndex = signal(0)

    @HostListener('document:keydown.ArrowUp', ['$event'])
    onArrowUp(event: KeyboardEvent) {
        event.preventDefault()
        this.scrollUp()
    }
    scrollUp() {
        const currentIndex = this.currentEmailIndex()
        if (currentIndex > 0) {
            this.currentEmailIndex.set(currentIndex - 1)
            const prevEntry = this.emailEntries()[currentIndex - 1]
            if (prevEntry) {
                prevEntry.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
        }
    }

    @HostListener('document:keydown.ArrowDown', ['$event'])
    onArrowDown(event: KeyboardEvent) {
        event.preventDefault()
        this.scrollDown()
    }
    scrollDown() {
        const currentIndex = this.currentEmailIndex()
        if (currentIndex < (this.bandcampEmails()?.length || 0) - 1) {
            this.currentEmailIndex.set(currentIndex + 1)
            this.furthestScrolledIndex.set(Math.max(this.furthestScrolledIndex(), currentIndex + 1))
            const nextEntry = this.emailEntries()[currentIndex + 1]
            if (nextEntry) {
                nextEntry.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
        }
    }

    onIntersectionChange(isIntersecting: boolean, _email: BandcampEmail, index: number) {
        if (isIntersecting) {
            this.currentEmailIndex.set(index)
            this.furthestScrolledIndex.set(Math.max(this.furthestScrolledIndex(), index))

            // @TODO: Mark email as read when it comes into view (or wait for a delay)
        }
    }
}
