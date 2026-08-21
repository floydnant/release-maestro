import { TestBed, waitForAsync } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { provideWebAudioPlayerMock } from '../test/mocks'
import { AppComponent } from './app.component'
import { ElectronService } from './core/services'

describe(AppComponent.name, () => {
    beforeEach(waitForAsync(() => {
        void TestBed.configureTestingModule({
            declarations: [],
            imports: [AppComponent, TranslateModule.forRoot()],
            providers: [provideRouter([]), ElectronService, provideWebAudioPlayerMock()],
        }).compileComponents()
    }))

    it('should create the app', waitForAsync(() => {
        const fixture = TestBed.createComponent(AppComponent)
        const app = fixture.debugElement.componentInstance
        expect(app).toBeTruthy()
    }))

    it('does not render Electron window controls in browser mode', () => {
        const fixture = TestBed.createComponent(AppComponent)

        fixture.detectChanges()

        expect(fixture.nativeElement.querySelector('.title-bar__controls')).toBeNull()
    })

    it('places history navigation in the full-height sidebar chrome', () => {
        const fixture = TestBed.createComponent(AppComponent)

        fixture.detectChanges()

        const sidebar = fixture.nativeElement.querySelector('aside.sidebar') as HTMLElement
        const history = sidebar.querySelector('nav[aria-label="History"]')
        expect(history).not.toBeNull()
        expect(fixture.nativeElement.querySelector('header.title-bar nav[aria-label="History"]')).toBeNull()
    })
})
