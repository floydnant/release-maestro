import {
    AfterViewInit,
    Directive,
    ElementRef,
    EventEmitter,
    inject,
    Input,
    OnDestroy,
    Output,
    signal,
} from '@angular/core'

@Directive({
    selector: '[appIntersection], [intersectionChange], [intersectionEntry]',
    exportAs: 'appIntersection',
})
export class IntersectionDirective implements AfterViewInit, OnDestroy {
    private elemRef = inject(ElementRef) as ElementRef<HTMLElement>

    @Input() intersectionThreshold = 1
    @Output() intersectionChange = new EventEmitter<boolean>()
    @Output() intersectionEntry = new EventEmitter<IntersectionObserverEntry>()

    isIntersecting = signal(false)

    observer = new IntersectionObserver(
        entries => {
            entries.forEach(entry => {
                this.isIntersecting.set(entry.isIntersecting)
                this.intersectionChange.emit(entry.isIntersecting)
                this.intersectionEntry.emit(entry)
            })
        },
        { threshold: [this.intersectionThreshold] },
    )

    ngAfterViewInit(): void {
        this.observer.observe(this.elemRef.nativeElement)
    }
    ngOnDestroy(): void {
        this.observer.disconnect()
    }
}
