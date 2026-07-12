import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { EMPTY } from 'rxjs'
import { FeedService } from '../../core/services/feed.service'
import { provideWebAudioPlayerMock } from '../../../test/mocks'
import { FeedComponent } from './feed.component'

describe(FeedComponent.name, () => {
    let component: FeedComponent
    let fixture: ComponentFixture<FeedComponent>

    beforeEach(waitForAsync(() => {
        void TestBed.configureTestingModule({
            declarations: [],
            imports: [FeedComponent, TranslateModule.forRoot()],
            providers: [
                provideRouter([]),
                provideWebAudioPlayerMock(),
                {
                    provide: FeedService,
                    useValue: {
                        emailImportProgress$: EMPTY,
                        loadFeed: jest.fn().mockResolvedValue([]),
                        hasFeed: jest.fn().mockResolvedValue(false),
                        markFeedItemViewed: jest.fn().mockResolvedValue(undefined),
                    } satisfies Partial<FeedService>,
                },
            ],
        }).compileComponents()

        fixture = TestBed.createComponent(FeedComponent)
        component = fixture.componentInstance
        fixture.detectChanges()
    }))

    it('should create', () => {
        expect(component).toBeTruthy()
    })
})
