import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing'
import { FeedComponent } from './feed.component'
import { TranslateModule } from '@ngx-translate/core'
import { provideRouter } from '@angular/router'

describe('DetailComponent', () => {
    let component: FeedComponent
    let fixture: ComponentFixture<FeedComponent>

    beforeEach(waitForAsync(() => {
        void TestBed.configureTestingModule({
            declarations: [],
            imports: [FeedComponent, TranslateModule.forRoot()],
            providers: [provideRouter([])],
        }).compileComponents()

        fixture = TestBed.createComponent(FeedComponent)
        component = fixture.componentInstance
        fixture.detectChanges()
    }))

    it('should create', () => {
        expect(component).toBeTruthy()
    })

    it('should render title in a h1 tag', waitForAsync(() => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const compiled = fixture.debugElement.nativeElement
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        expect(compiled.querySelector('h1').textContent).toContain('PAGES.DETAIL.TITLE')
    }))
})
