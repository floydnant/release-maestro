//! Retain native tags that Lofty cannot keep inside a generic Tag.
//! ID3 and MP4 keep native snapshots. Vorbis and APE use split/merge;
//! RIFF requires explicitly restoring unmapped entries.

use crate::{custom_tags, id3_tags::Id3Snapshot, mp4_tags::Mp4Snapshot};
use lofty::{
    aac::AacFile,
    ape::{ApeFile, ApeItem, ApeTag},
    config::{ParseOptions, WriteOptions},
    error::{FileEncodingError, FileParseError},
    file::{AudioFile, FileType, TaggedFile, TaggedFileExt},
    flac::FlacFile,
    iff::{
        aiff::AiffFile,
        wav::{RiffInfoList, WavFile},
    },
    mp4::Mp4File,
    mpeg::MpegFile,
    musepack::MpcFile,
    ogg::{tag::VorbisComments, OpusFile, SpeexFile, VorbisFile},
    probe::Probe,
    tag::{ItemKey, ItemValue, MergeTag, SplitTag, Tag, TagExt, TagItem, TagType},
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
pub struct NativeTags {
    preserved: Option<PreservedTag>,
    id3: Id3Snapshot,
}

pub fn read_file(path: &Path) -> Result<(TaggedFile, NativeTags), FileParseError> {
    let probe = Probe::open(path)?.guess_file_type()?;
    let file_type = probe.file_type();
    let mut reader = probe.into_inner();
    let options = ParseOptions::new();
    // Preserve native ID3 ratings and custom frame identities before generic conversion.
    macro_rules! optional_tag {
        ($file:ty, $getter:ident, $variant:ident) => {{
            let mut file = <$file as AudioFile>::read_from(&mut reader, options)?;
            let native = NativeTags {
                preserved: Some(PreservedTag::$variant(
                    file.$getter().cloned().unwrap_or_default(),
                )),
                id3: Id3Snapshot::take(file.id3v2_mut()),
            };
            (file.into(), native)
        }};
    }
    macro_rules! required_tag {
        ($file:ty) => {{
            let file = <$file as AudioFile>::read_from(&mut reader, options)?;
            let native = PreservedTag::Vorbis(file.vorbis_comments().clone());
            (
                file.into(),
                NativeTags {
                    preserved: Some(native),
                    ..NativeTags::default()
                },
            )
        }};
    }
    macro_rules! id3_tag {
        ($file:ty) => {{
            let mut file = <$file as AudioFile>::read_from(&mut reader, options)?;
            let native = NativeTags {
                id3: Id3Snapshot::take(file.id3v2_mut()),
                ..NativeTags::default()
            };
            (file.into(), native)
        }};
    }
    let (mut file, native): (TaggedFile, NativeTags) = match file_type {
        Some(FileType::Mp4) => {
            let file = Mp4File::read_from(&mut reader, options)?;
            let original = file.ilst().cloned().unwrap_or_default();
            let tag = Tag::from(original.clone());
            let native = Mp4Snapshot::new(original, &tag);
            (
                file.into(),
                NativeTags {
                    preserved: Some(PreservedTag::Mp4(native)),
                    ..NativeTags::default()
                },
            )
        }
        Some(FileType::Flac) => optional_tag!(FlacFile, vorbis_comments, Vorbis),
        Some(FileType::Vorbis) => required_tag!(VorbisFile),
        Some(FileType::Opus) => required_tag!(OpusFile),
        Some(FileType::Speex) => required_tag!(SpeexFile),
        Some(FileType::Ape) => optional_tag!(ApeFile, ape, Ape),
        Some(FileType::Mpc) => optional_tag!(MpcFile, ape, Ape),
        Some(FileType::WavPack) => {
            let file = WavPackFile::read_from(&mut reader, options)?;
            let native = NativeTags {
                preserved: Some(PreservedTag::Ape(file.ape().cloned().unwrap_or_default())),
                ..NativeTags::default()
            };
            (file.into(), native)
        }
        Some(FileType::Mpeg) => optional_tag!(MpegFile, ape, Ape),
        Some(FileType::Wav) => optional_tag!(WavFile, riff_info, Riff),
        Some(FileType::Aiff) => id3_tag!(AiffFile),
        Some(FileType::Aac) => id3_tag!(AacFile),
        _ => (
            Probe::new(reader).guess_file_type()?.read()?,
            NativeTags::default(),
        ),
    };
    if let Some(tag) = file.tag_mut(TagType::Ape) {
        join_ape_text_values(tag);
    }
    Ok((file, native))
}

fn join_ape_text_values(tag: &mut Tag) {
    // Lofty now splits APE lists; retain the existing NUL-delimited scalar contract.
    // Each native list becomes consecutive generic items. Keep their position,
    // and copy binary/locator items unchanged.
    let mut joined: Vec<TagItem> = Vec::new();
    for item in tag.items() {
        if let Some(previous) = joined
            .last_mut()
            .filter(|previous| previous.key() == item.key())
        {
            if let (Some(left), Some(right)) = (previous.value().text(), item.value().text()) {
                *previous = TagItem::new(item.key(), ItemValue::Text(format!("{left}\0{right}")));
                continue;
            }
        }
        joined.push(item.clone());
    }
    tag.retain(|_| false);
    for item in joined {
        tag.push_unchecked(item);
    }
}

impl NativeTags {
    pub fn riff_alias_update(&self, fields: &[custom_tags::LegacyField]) -> Option<RiffInfoList> {
        match &self.preserved {
            Some(PreservedTag::Riff(native)) => {
                custom_tags::remove_riff_aliases(native.clone(), fields)
            }
            _ => None,
        }
    }

    pub fn read(&self, tag: &Tag) -> Vec<(String, String)> {
        if tag.tag_type() == TagType::Id3v2 {
            // Older Lofty kept four-character descriptions in the companion tag,
            // ahead of longer custom descriptions rebuilt from generic items.
            let mut fields = self.id3.read_custom();
            fields.extend(custom_tags::read(tag, None));
            return fields;
        }
        let Some(native) = self
            .preserved
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
        if tag.tag_type() == TagType::Id3v2 {
            self.id3.remove_aliases(canonical, aliases);
        }
        match self
            .preserved
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
        if tag.tag_type() == TagType::Id3v2 {
            return self.id3.merge(tag).save_to_path(path, options);
        }
        match self
            .preserved
            .as_ref()
            .filter(|native| native.tag_type() == tag.tag_type())
        {
            Some(PreservedTag::Vorbis(native)) => {
                // Ratings are not editable here. Lofty consumes numeric RATING values on
                // split but expects a different representation on merge, so restore them.
                let mut edited = tag.clone();
                edited.remove_key(ItemKey::Popularimeter);
                let mut merged = native.clone().split_tag().0.merge_tag(edited);
                let ratings: Vec<_> = native
                    .items()
                    .filter(|(name, _)| {
                        name.split(':')
                            .next()
                            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("RATING"))
                    })
                    .collect();
                for (name, _) in &ratings {
                    merged.remove(name).for_each(drop);
                }
                for (name, value) in ratings {
                    merged.push(name.to_owned(), value.to_owned());
                }
                merged.save_to_path(path, options)?;
            }
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
            None => tag.save_to_path(path, options)?,
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joining_ape_lists_preserves_precedence_between_lyric_fields() {
        for second in [vec!["last"], vec!["last", "also last"]] {
            let mut tag = Tag::new(TagType::Ape);
            for (key, values) in [
                (ItemKey::Lyrics, vec!["first", "also first"]),
                (ItemKey::UnsyncLyrics, second.clone()),
            ] {
                for value in values {
                    tag.push(TagItem::new(key, ItemValue::Text(value.into())));
                }
            }

            join_ape_text_values(&mut tag);

            let actual: Vec<_> = tag
                .items()
                .map(|item| (item.key(), item.value().text().unwrap().to_owned()))
                .collect();
            assert_eq!(
                actual,
                vec![
                    (ItemKey::Lyrics, "first\0also first".into()),
                    (ItemKey::UnsyncLyrics, second.join("\0")),
                ]
            );
        }
    }

    #[test]
    fn joining_ape_lists_preserves_binary_and_locator_values() {
        let items = [
            TagItem::new(ItemKey::TrackTitle, ItemValue::Binary(vec![0, 1, 255])),
            TagItem::new(
                ItemKey::TrackArtist,
                ItemValue::Locator("https://example.com/artist".into()),
            ),
            TagItem::new(ItemKey::Genre, ItemValue::Text("Techno".into())),
            TagItem::new(ItemKey::Genre, ItemValue::Text("Ambient".into())),
        ];
        let mut tag = Tag::new(TagType::Ape);
        for item in &items {
            tag.push(item.clone());
        }

        join_ape_text_values(&mut tag);

        assert_eq!(
            tag.items().cloned().collect::<Vec<_>>(),
            vec![
                items[0].clone(),
                items[1].clone(),
                TagItem::new(ItemKey::Genre, ItemValue::Text("Techno\0Ambient".into()))
            ]
        );
    }

    #[test]
    fn invalid_ape_replacement_leaves_existing_metadata_intact() {
        let mut original = ApeTag::new();
        original.insert(ApeItem::new("ENERGY".into(), ItemValue::Text("7".into())).unwrap());
        let mut native = NativeTags {
            preserved: Some(PreservedTag::Ape(original)),
            ..NativeTags::default()
        };
        let mut tag = Tag::new(TagType::Ape);
        assert!(native
            .replace_text(&mut tag, "x", &["ENERGY"], Some("value".into()))
            .is_err());
        assert!(native.read(&tag).contains(&("ENERGY".into(), "7".into())));
    }
}
