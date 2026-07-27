import { NgClass } from '@angular/common'
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core'
import { LibraryRootValidation } from '@release-maestro/core'
import { ElectronService } from '../../../core/services'
import { splitPathBaseName } from '../../utils/formatting.utils'
import { IconComponent } from '../icon/icon.component'

/**
 * Editable list of library root folders, doubling as a drop target for folders
 * dragged in from the OS. Shows the per-root validation results (unavailable /
 * nested) inline. Purely presentational: the host owns the folder list and opens
 * the folder picker when {@link FolderListComponent.browse} is emitted.
 *
 * Adding is deliberately *not* part of this component — the import flow and the
 * settings page place their "add folders" affordance differently. Anything
 * projected into the component renders as the last row inside the list panel.
 */
@Component({
    selector: 'app-folder-list',
    imports: [IconComponent, NgClass],
    templateUrl: './folder-list.component.html',
    styleUrls: ['./folder-list.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderListComponent {
    readonly folders = input.required<string[]>()
    readonly validations = input<LibraryRootValidation[]>([])
    readonly useMinHeight = input<boolean>(true)

    /** Folders dropped onto the list (absolute paths; non-folder drops included). */
    readonly foldersDropped = output<string[]>()
    /** The empty-state drop zone was clicked — the host should open the folder picker. */
    readonly browse = output<void>()
    readonly folderRemoved = output<string>()

    /** True while folders are being dragged over the list (drop-target highlight). */
    readonly isDragging = signal(false)

    private readonly electronService = inject(ElectronService)
    // Depth counter so dragenter/dragleave bubbling over children doesn't flicker.
    private dragDepth = 0

    validationFor(folder: string): LibraryRootValidation | undefined {
        return this.validations().find(validation => validation.path === folder)
    }

    folderParent(path: string): string {
        return splitPathBaseName(path).parent
    }

    folderName(path: string): string {
        return splitPathBaseName(path).base || path
    }

    onDragEnter(event: DragEvent): void {
        if (!hasFileDrag(event)) return
        event.preventDefault()
        this.dragDepth++
        this.isDragging.set(true)
    }

    onDragOver(event: DragEvent): void {
        if (!hasFileDrag(event)) return
        // Both preventDefault and a copy dropEffect are required for `drop` to fire.
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    onDragLeave(): void {
        this.dragDepth = Math.max(0, this.dragDepth - 1)
        if (this.dragDepth === 0) this.isDragging.set(false)
    }

    onDrop(event: DragEvent): void {
        event.preventDefault()
        this.dragDepth = 0
        this.isDragging.set(false)
        const paths = Array.from(event.dataTransfer?.files ?? [])
            .map(file => this.electronService.getPathForFile(file))
            .filter((path): path is string => path !== null)
        if (paths.length === 0) return
        // Non-folder drops (files) are kept too — validation flags them as "Not a folder".
        this.foldersDropped.emit(paths)
    }
}

/** True when a drag carries filesystem items (so we can offer to add them as folders). */
const hasFileDrag = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')
