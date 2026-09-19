//! Custom fields live in format-specific tags, outside Lofty's generic ItemKey model.
//! Converting back retains the companion tag, including opaque frames and artwork.

use lofty::{
    ape::{ApeItem, ApeTag},
    config::{ParseOptions, WriteOptions},
    file::{AudioFile, FileType, TaggedFile, TaggedFileExt},
    id3::v2::{Frame, Id3v2Tag},
    iff::wav::RiffInfoList,
    mp4::{Atom, AtomData, AtomIdent, Ilst, Mp4File},
    ogg::VorbisComments,
    probe::Probe,
    tag::{ItemKey, ItemValue, Tag, TagExt, TagItem, TagType},
};

// Lofty 0.22 consumes only the first value of each MP4 atom during conversion.
// Restore the other text values before the native tag is discarded.
fn from_mp4(native: Ilst) -> Tag {
    let mut tag = Tag::from(native.clone());
    for atom in &native {
        let name = match atom.ident() {
            AtomIdent::Freeform { mean, name } => format!("----:{mean}:{name}"),
            AtomIdent::Fourcc(bytes) => bytes.iter().map(|byte| char::from(*byte)).collect(),
        };
        if matches!(
            atom.data().next(),
            Some(AtomData::UTF8(_) | AtomData::UTF16(_))
        ) {
            for value in atom.data().skip(1) {
                if let AtomData::UTF8(value) | AtomData::UTF16(value) = value {
                    tag.push_unchecked(TagItem::new(
                        ItemKey::from_key(TagType::Mp4Ilst, &name),
                        ItemValue::Text(value.clone()),
                    ));
                }
            }
        }
    }
    tag
}

pub fn read_from_path(path: &std::path::Path) -> lofty::error::Result<TaggedFile> {
    let probe = Probe::open(path)?.guess_file_type()?;
    if probe.file_type() == Some(FileType::Mp4) {
        let file = Mp4File::read_from(&mut probe.into_inner(), ParseOptions::new())?;
        let tag = file.ilst().cloned().map(from_mp4);
        let mut file: TaggedFile = file.into();
        if let Some(tag) = tag {
            file.insert_tag(tag);
        }
        Ok(file)
    } else {
        probe.read()
    }
}

pub fn save(tag: &Tag, path: &std::path::Path) -> lofty::error::Result<()> {
    let options = WriteOptions::new().remove_others(false);
    if tag.tag_type() == TagType::Id3v2 {
        native_id3(tag.clone()).save_to_path(path, options)
    } else if tag.tag_type() == TagType::Ape {
        native_ape(tag.clone())?.save_to_path(path, options)
    } else {
        tag.save_to_path(path, options)
    }
}

pub fn is_custom_key(tag_type: TagType, name: &str) -> bool {
    ItemKey::from_key(tag_type, name)
        .map_key(tag_type, false)
        .is_none()
}

fn native_id3(mut tag: Tag) -> Id3v2Tag {
    // Lofty 0.22 merges known multi-value fields but replaces repeated custom
    // text items. Join their values before conversion so none are discarded.
    let keys: Vec<_> = tag
        .items()
        .filter(|item| item.key().map_key(TagType::Id3v2, false).is_none())
        .map(|item| item.key().clone())
        .collect();
    for key in keys {
        if tag.get_strings(&key).count() > 1
            && tag
                .get_items(&key)
                .all(|item| item.value().text().is_some())
        {
            let values: Vec<_> = tag.take_strings(&key).collect();
            tag.insert_unchecked(TagItem::new(key, ItemValue::Text(values.join("\0"))));
        }
    }
    Id3v2Tag::from(tag)
}

fn native_ape(tag: Tag) -> lofty::error::Result<ApeTag> {
    // Lofty 0.22's Tag -> ApeTag conversion drops unmapped items. Preserve them
    // explicitly before saving or reading custom fields.
    let mut custom = Vec::new();
    for item in tag.items() {
        if item.key().map_key(TagType::Ape, false).is_none() {
            if let Some(name) = item.key().map_key(TagType::Ape, true) {
                custom.push(ApeItem::new(name.to_owned(), item.value().clone())?);
            }
        }
    }
    let mut native = ApeTag::from(tag);
    for item in custom {
        native.insert(item);
    }
    Ok(native)
}

pub fn read(tag: &Tag) -> lofty::error::Result<Vec<(String, String)>> {
    let mut fields = Vec::new();
    let mut push = |name: &str, value: &str, force: bool| {
        if !name.is_empty() && (force || is_custom_key(tag.tag_type(), name)) {
            if tag.tag_type() == TagType::Id3v2 {
                fields.extend(
                    value
                        .split('\0')
                        .map(|value| (name.to_owned(), value.to_owned())),
                );
            } else {
                fields.push((name.to_owned(), value.to_owned()));
            }
        }
    };
    match tag.tag_type() {
        TagType::Id3v2 => {
            let native = native_id3(tag.clone());
            for frame in &native {
                match frame {
                    Frame::UserText(frame) => push(
                        &frame.description,
                        &frame.content,
                        frame.description.len() == 4,
                    ),
                    Frame::UserUrl(frame) => push(
                        &frame.description,
                        &frame.content,
                        frame.description.len() == 4,
                    ),
                    Frame::Text(text) => push(frame.id_str(), &text.value, false),
                    Frame::Url(url) => push(frame.id_str(), url.url(), false),
                    _ => {}
                }
            }
        }
        TagType::VorbisComments => {
            for (name, value) in VorbisComments::from(tag.clone()).items() {
                push(name, value, false);
            }
        }
        TagType::Ape => {
            let native = native_ape(tag.clone())?;
            for item in &native {
                push(
                    item.key(),
                    item.value()
                        .text()
                        .or_else(|| item.value().locator())
                        .unwrap_or_default(),
                    false,
                );
            }
        }
        TagType::Mp4Ilst => {
            let native = Ilst::from(tag.clone());
            for atom in &native {
                let name = match atom.ident() {
                    AtomIdent::Freeform { mean, name } => format!("----:{mean}:{name}"),
                    AtomIdent::Fourcc(bytes) => {
                        bytes.iter().map(|byte| char::from(*byte)).collect()
                    }
                };
                for data in atom.data() {
                    match data {
                        AtomData::UTF8(value) | AtomData::UTF16(value) => push(&name, value, false),
                        _ => {}
                    }
                }
            }
            // Older Lofty releases keep integer tmpo atoms in the companion tag.
            if let Some(atom) = native.get(&AtomIdent::Fourcc(*b"tmpo")) {
                for data in atom.data() {
                    let value = match data {
                        AtomData::SignedInteger(value) => Some(value.to_string()),
                        AtomData::UnsignedInteger(value) => Some(value.to_string()),
                        _ => None,
                    };
                    if let Some(value) = value {
                        fields.push(("BPM".to_owned(), value));
                    }
                }
            }
        }
        TagType::RiffInfo => {
            let native = RiffInfoList::from(tag.clone());
            for (name, value) in &native {
                push(name, value, false);
            }
        }
        _ => {}
    }
    Ok(fields)
}

/// Replace all case variants of the aliases with one canonical custom text field.
/// `None` removes them. Standard fields must be updated after alias removal.
pub fn replace_text(
    tag: &mut Tag,
    canonical: &str,
    aliases: &[&str],
    value: Option<String>,
) -> lofty::error::Result<()> {
    let matches = |name: &str| {
        name.eq_ignore_ascii_case(canonical)
            || aliases.iter().any(|alias| name.eq_ignore_ascii_case(alias))
    };
    let tag_type = tag.tag_type();
    let owned = tag.clone();
    *tag = match tag_type {
        TagType::Id3v2 => {
            let mut native = native_id3(owned);
            native.retain(|frame| match frame {
                Frame::UserText(text) => !matches(&text.description),
                Frame::UserUrl(url) => !matches(&url.description),
                _ => true,
            });
            if let Some(value) = value {
                native.insert_user_text(canonical.to_owned(), value);
            }
            native.into()
        }
        TagType::VorbisComments => {
            let mut native = VorbisComments::from(owned);
            for alias in std::iter::once(canonical).chain(aliases.iter().copied()) {
                native.remove(alias).for_each(drop);
            }
            if let Some(value) = value {
                native.insert(canonical.to_owned(), value);
            }
            native.into()
        }
        TagType::Ape => {
            let mut native = native_ape(owned)?;
            for alias in std::iter::once(canonical).chain(aliases.iter().copied()) {
                native.remove(alias);
            }
            if let Some(value) = value {
                native.insert(ApeItem::new(canonical.to_owned(), ItemValue::Text(value))?);
            }
            native.into()
        }
        TagType::Mp4Ilst => {
            let mut native = Ilst::from(owned);
            native.retain(|atom| {
                !matches!(atom.ident(), AtomIdent::Freeform { mean, name }
                if mean == "com.apple.iTunes" && matches(name))
            });
            if let Some(value) = value {
                native.insert(Atom::new(
                    AtomIdent::Freeform {
                        mean: "com.apple.iTunes".into(),
                        name: canonical.to_owned().into(),
                    },
                    AtomData::UTF8(value),
                ));
            }
            from_mp4(native)
        }
        _ => owned,
    };
    Ok(())
}

/// Integer MP4 tempo can live outside the generic tag in Lofty's companion data.
pub fn remove_bpm(tag: &mut Tag) -> lofty::error::Result<()> {
    let aliases = LegacyField::Bpm.aliases();
    replace_text(tag, aliases[0], &aliases[1..], None)?;
    if tag.tag_type() == TagType::Mp4Ilst {
        let owned = std::mem::replace(tag, Tag::new(TagType::Mp4Ilst));
        let mut native = Ilst::from(owned);
        native.remove(&AtomIdent::Fourcc(*b"tmpo")).for_each(drop);
        *tag = from_mp4(native);
    }
    Ok(())
}

#[derive(Clone, Copy)]
pub enum LegacyField {
    Energy,
    Bpm,
    MusicalKey,
    Comment,
    CatalogNumber,
    Lyrics,
}

impl LegacyField {
    pub fn aliases(self) -> &'static [&'static str] {
        match self {
            Self::Energy => &["ENERGY", "ENERGYLEVEL"],
            Self::Bpm => &["BPM", "TBPM"],
            Self::MusicalKey => &["KEY", "TKEY", "INITIALKEY", "INITIAL KEY"],
            Self::Comment => &["COMMENT"],
            Self::CatalogNumber => &[
                "CATALOGNUMBER",
                "CATALOGUENUMBER",
                "CATALOGID",
                "CATALOG",
                "CATALOG NUMBER",
                "CATALOG ID",
                "CATALOG #",
                "CAT#",
            ],
            Self::Lyrics => &["LYRICS"],
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        [
            Self::Energy,
            Self::Bpm,
            Self::MusicalKey,
            Self::Comment,
            Self::CatalogNumber,
            Self::Lyrics,
        ]
        .into_iter()
        .find(|field| {
            field
                .aliases()
                .iter()
                .any(|alias| name.eq_ignore_ascii_case(alias))
        })
    }

    pub fn replace(self, tag: &mut Tag, value: Option<String>) -> Result<(), String> {
        let aliases = self.aliases();
        replace_text(tag, aliases[0], &aliases[1..], value).map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_ape_keys_fail_conversion_without_erasing_items() {
        let mut tag = Tag::new(TagType::Ape);
        let key = ItemKey::from_key(TagType::Ape, "x");
        tag.push_unchecked(TagItem::new(key.clone(), ItemValue::Text("keep me".into())));
        assert!(read(&tag).is_err());
        assert!(LegacyField::Energy
            .replace(&mut tag, Some("7".into()))
            .is_err());
        assert_eq!(tag.get_string(&key), Some("keep me"));
    }

    #[test]
    fn invalid_replacement_ape_key_returns_an_error() {
        let mut tag = Tag::new(TagType::Ape);
        assert!(replace_text(&mut tag, "x", &[], Some("value".into())).is_err());
        assert!(tag.is_empty());
    }
}
