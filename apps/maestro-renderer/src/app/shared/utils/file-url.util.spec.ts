import { fileUrl } from './file-url.util'

describe('fileUrl', () => {
    it('encodes reserved characters and unicode in a POSIX path', () => {
        expect(fileUrl('/music/100% hits/été #1?.jpg')).toBe(
            'file:///music/100%25%20hits/%C3%A9t%C3%A9%20%231%3F.jpg',
        )
    })

    it('uses an empty authority for a Windows drive-letter path', () => {
        expect(fileUrl('C:\\Music\\Album Art.jpg')).toBe('file:///C:/Music/Album%20Art.jpg')
    })

    it('preserves the host of a Windows UNC path', () => {
        expect(fileUrl('\\\\media-server\\Music\\Album Art.jpg')).toBe(
            'file://media-server/Music/Album%20Art.jpg',
        )
    })
})
