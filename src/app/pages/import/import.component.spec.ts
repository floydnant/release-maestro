import { ComponentFixture, TestBed } from '@angular/core/testing'
import { ActivatedRoute } from '@angular/router'
import { ImportComponent } from './import.component'

describe(ImportComponent.name, () => {
    let component: ImportComponent
    let fixture: ComponentFixture<ImportComponent>

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ImportComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {} satisfies Partial<ActivatedRoute>,
                },
            ],
        }).compileComponents()

        fixture = TestBed.createComponent(ImportComponent)
        component = fixture.componentInstance
        fixture.detectChanges()
    })

    // @TODO: tests
    it('should create', () => {
        expect(component).toBeTruthy()
    })
})
