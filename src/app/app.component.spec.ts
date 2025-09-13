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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const app = fixture.debugElement.componentInstance
        expect(app).toBeTruthy()
    }))
})
