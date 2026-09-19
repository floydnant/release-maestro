//! Retain native tags that Lofty cannot keep inside a generic Tag.
//! MP4 keeps a native snapshot. Vorbis and APE use split/merge;
//! RIFF requires explicitly restoring unmapped entries.

use crate::{custom_tags, mp4_tags::Mp4Snapshot};
use lofty::{
    ape::{ApeFile, ApeItem, ApeTag},
    config::{ParseOptions, WriteOptions},
    error::{FileEncodingError, FileParseError},
    file::{AudioFile, FileType, TaggedFile},
    flac::FlacFile,
    iff::wav::{RiffInfoList, WavFile},
    mp4::Mp4File,
    mpeg::MpegFile,
    musepack::MpcFile,
    ogg::{tag::VorbisComments, OpusFile, SpeexFile, VorbisFile},
    probe::Probe,
    tag::{ItemValue, MergeTag, SplitTag, Tag, TagExt, TagType},
    wavpack::WavPackFile,
};
use std::path::Path;

enum PreservedTag {
    Vorbis(VorbisComments),
    Ape(ApeTag),
    Riff(RiffInfoList),
    Mp4(Mp4Snapshot),
}

impl PreservedTag {
    fn tag_type(&self) -> TagType {
        match self {
            Self::Vorbis(_) => TagType::VorbisComments,
            Self::Ape(_) => TagType::Ape,
            Self::Riff(_) => TagType::RiffInfo,
            Self::Mp4(_) => TagType::Mp4Ilst,
        }
    }
}

#[derive(Default)]
pub struct NativeTags(Option<PreservedTag>);

pub fn read_file(path: &Path) -> Result<(TaggedFile, NativeTags), FileParseError> {
    let probe = Probe::open(path)?.guess_file_type()?;
    let file_type = probe.file_type();
    let mut reader = probe.into_inner();
    let options = ParseOptions::new();
    // Each supported format needs at most one separately retained native tag.
    macro_rules! optional_tag {
        ($file:ty, $getter:ident, $variant:ident) => {{
            let file = <$file as AudioFile>::read_from(&mut reader, options)?;
            let native = PreservedTag::$variant(file.$getter().cloned().unwrap_or_default());
            (file.into(), NativeTags(Some(native)))
        }};
    }
    macro_rules! required_tag {
        ($file:ty) => {{
            let file = <$file as AudioFile>::read_from(&mut reader, options)?;
            let native = PreservedTag::Vorbis(file.vorbis_comments().clone());
            (file.into(), NativeTags(Some(native)))
        }};
    }
    Ok(match file_type {
        Some(FileType::Mp4) => {
            let file = Mp4File::read_from(&mut reader, options)?;
            let original = file.ilst().cloned().unwrap_or_default();
            let tag = Tag::from(original.clone());
            let native = Mp4Snapshot::new(original, &tag);
            (file.into(), NativeTags(Some(PreservedTag::Mp4(native))))
        }
        Some(FileType::Flac) => optional_tag!(FlacFile, vorbis_comments, Vorbis),
        Some(FileType::Vorbis) => required_tag!(VorbisFile),
        Some(FileType::Opus) => required_tag!(OpusFile),
        Some(FileType::Speex) => required_tag!(SpeexFile),
        Some(FileType::Ape) => optional_tag!(ApeFile, ape, Ape),
        Some(FileType::Mpc) => optional_tag!(MpcFile, ape, Ape),
        Some(FileType::WavPack) => optional_tag!(WavPackFile, ape, Ape),
        Some(FileType::Mpeg) => optional_tag!(MpegFile, ape, Ape),
        Some(FileType::Wav) => optional_tag!(WavFile, riff_info, Riff),
        _ => (
            Probe::new(reader).guess_file_type()?.read()?,
            NativeTags::default(),
        ),
    })
}

impl NativeTags {
    pub fn riff_alias_update(&self, fields: &[custom_tags::LegacyField]) -> Option<RiffInfoList> {
        match &self.0 {
            Some(PreservedTag::Riff(native)) => {
                custom_tags::remove_riff_aliases(native.clone(), fields)
            }
            _ => None,
        }
    }

    pub fn read(&self, tag: &Tag) -> Vec<(String, String)> {
        let Some(native) = self
            .0
            .as_ref()
            .filter(|native| native.tag_type() == tag.tag_type())
        else {
            return custom_tags::read(tag, None);
        };
        let fields: Vec<_> = match native {
            PreservedTag::Vorbis(native) => native
                .items()
                .map(|(k, v)| (k.to_owned(), v.to_owned()))
                .collect(),
            PreservedTag::Ape(native) => native
                .into_iter()
                .map(|item| {
                    (
                        item.key().to_owned(),
                        item.value()
                            .text()
                            .or_else(|| item.value().locator())
                            .unwrap_or_default()
                            .to_owned(),
                    )
                })
                .collect(),
            PreservedTag::Riff(native) => native.into_iter().cloned().collect(),
            PreservedTag::Mp4(native) => return custom_tags::read(tag, Some(native.original())),
        };
        fields
            .into_iter()
            .filter(|(name, _)| custom_tags::is_custom_key(tag.tag_type(), name))
            .collect()
    }

    pub fn replace_text(
        &mut self,
        tag: &mut Tag,
        canonical: &str,
        aliases: &[&str],
        value: Option<String>,
    ) -> Result<(), String> {
        match self
            .0
            .as_mut()
            .filter(|native| native.tag_type() == tag.tag_type())
        {
            Some(PreservedTag::Vorbis(native)) => {
                for alias in std::iter::once(canonical).chain(aliases.iter().copied()) {
                    native.remove(alias).for_each(drop);
                }
                if let Some(value) = value {
                    native.insert(canonical.to_owned(), value);
                }
            }
            Some(PreservedTag::Ape(native)) => {
                let replacement = value
                    .map(|value| ApeItem::new(canonical.to_owned(), ItemValue::Text(value)))
                    .transpose()
                    .map_err(|error| error.to_string())?;
                for alias in std::iter::once(canonical).chain(aliases.iter().copied()) {
                    native.remove(alias);
                }
                if let Some(item) = replacement {
                    native.insert(item);
                }
            }
            None | Some(PreservedTag::Riff(_)) | Some(PreservedTag::Mp4(_)) => {
                custom_tags::replace_text(tag, canonical, aliases, value)
            }
        }
        Ok(())
    }

    pub fn save(&self, tag: &Tag, path: &Path) -> Result<(), FileEncodingError> {
        let options = WriteOptions::new().remove_others(false);
        match self
            .0
            .as_ref()
            .filter(|native| native.tag_type() == tag.tag_type())
        {
            Some(PreservedTag::Vorbis(native)) => native
                .clone()
                .split_tag()
                .0
                .merge_tag(tag.clone())
                .save_to_path(path, options)?,
            Some(PreservedTag::Ape(native)) => native
                .clone()
                .split_tag()
                .0
                .merge_tag(tag.clone())
                .save_to_path(path, options)?,
            Some(PreservedTag::Riff(native)) => {
                // RIFF's split remainder is empty, so restore unmapped entries explicitly.
                let mut merged = RiffInfoList::from(tag.clone());
                for (name, value) in native {
                    if custom_tags::is_custom_key(TagType::RiffInfo, name) {
                        merged.insert(name.clone(), value.clone());
                    }
                }
                merged.save_to_path(path, options)?;
            }
            Some(PreservedTag::Mp4(native)) => native.merge(tag).save_to_path(path, options)?,
            None if tag.tag_type() == TagType::Id3v2 => save_id3(tag, path, options)?,
            None => tag.save_to_path(path, options)?,
        }
        Ok(())
    }
}

// Lofty 0.25.2 subtracts growth when replacing a trailing RIFF/FORM ID3
// chunk, corrupting its size or panicking on large growth in debug builds.
// Remove the old chunk first so the writer uses its append path instead.
fn save_id3(tag: &Tag, path: &Path, options: WriteOptions) -> Result<(), FileEncodingError> {
    use std::io::{Cursor, Read, Seek, Write};
    let write_path = std::fs::canonicalize(path)?;
    let bytes = std::fs::read(&write_path)?;
    let mut file = Cursor::new(bytes);
    let mut header = [0; 12];
    file.read_exact(&mut header)?;
    let chunk_file = matches!(
        (&header[..4], &header[8..]),
        (b"RIFF", b"WAVE") | (b"FORM", b"AIFF" | b"AIFC")
    );
    file.rewind()?;
    if chunk_file {
        // Check encoding before deleting the existing tag.
        tag.dump_to(&mut std::io::sink(), options)?;
        TagType::Id3v2.remove_from(&mut file, options)?;
        file.rewind()?;
        tag.save_to(&mut file, options)?;
        let permissions = std::fs::metadata(&write_path)?.permissions();
        let parent = write_path.parent().unwrap_or_else(|| Path::new("."));
        let mut replacement = tempfile::NamedTempFile::new_in(parent)?;
        replacement.as_file().set_permissions(permissions)?;
        replacement.write_all(&file.into_inner())?;
        replacement.as_file().sync_all()?;
        replacement
            .persist(&write_path)
            .map_err(|error| error.error)?;
        return Ok(());
    }

    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(write_path)?;
    tag.save_to(&mut file, options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_ape_replacement_leaves_existing_metadata_intact() {
        let mut original = ApeTag::new();
        original.insert(ApeItem::new("ENERGY".into(), ItemValue::Text("7".into())).unwrap());
        let mut native = NativeTags(Some(PreservedTag::Ape(original)));
        let mut tag = Tag::new(TagType::Ape);
        assert!(native
            .replace_text(&mut tag, "x", &["ENERGY"], Some("value".into()))
            .is_err());
        assert!(native.read(&tag).contains(&("ENERGY".into(), "7".into())));
    }
}
