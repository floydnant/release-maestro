//! Custom fields live in format-specific tags, outside Lofty's generic ItemKey model.
//! Converting back retains the companion tag, including opaque frames and artwork.

use lofty::{
    ape::{ApeItem, ApeTag},
    config::WriteOptions,
    id3::v2::{Frame, Id3v2Tag},
    iff::wav::RiffInfoList,
    mp4::{Atom, AtomData, AtomIdent, Ilst},
    ogg::VorbisComments,
    tag::{ItemKey, ItemValue, Tag, TagExt, TagItem, TagType},
};

pub fn save(tag: &Tag, path: &std::path::Path) -> lofty::error::Result<()> {
    let options = WriteOptions::new().remove_others(false);
    if tag.tag_type() == TagType::Id3v2 {
        native_id3(tag.clone()).save_to_path(path, options)
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

fn native_ape(tag: Tag) -> ApeTag {
    // Lofty 0.22's Tag -> ApeTag conversion drops unmapped items. Preserve them
    // explicitly until the upgrade provides APE companion-tag round trips.
    let custom: Vec<_> = tag
        .items()
        .filter_map(|item| {
            if item.key().map_key(TagType::Ape, false).is_some() {
                return None;
            }
            let name = item.key().map_key(TagType::Ape, true)?;
            ApeItem::new(name.to_owned(), item.value().clone()).ok()
        })
        .collect();
    let mut native = ApeTag::from(tag);
    for item in custom {
        native.insert(item);
    }
    native
}

pub fn read(tag: &Tag) -> Vec<(String, String)> {
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
            let native = native_ape(tag.clone());
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
    fields
}

/// Replace all case variants of the aliases with one canonical custom text field.
/// `None` removes them. Standard fields must be updated after alias removal.
pub fn replace_text(tag: &mut Tag, canonical: &str, aliases: &[&str], value: Option<String>) {
    let matches = |name: &str| {
        name.eq_ignore_ascii_case(canonical)
            || aliases.iter().any(|alias| name.eq_ignore_ascii_case(alias))
    };
    let tag_type = tag.tag_type();
    let owned = std::mem::replace(tag, Tag::new(tag_type));
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
            let mut native = native_ape(owned);
            for alias in std::iter::once(canonical).chain(aliases.iter().copied()) {
                native.remove(alias);
            }
            if let Some(value) = value {
                native.insert(
                    ApeItem::new(canonical.to_owned(), ItemValue::Text(value))
                        .expect("custom field names are valid APE keys"),
                );
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
            native.into()
        }
        _ => owned,
    };
}

/// Integer MP4 tempo can live outside the generic tag in Lofty's companion data.
pub fn remove_bpm(tag: &mut Tag) {
    replace_text(tag, "BPM", &["TBPM"], None);
    if tag.tag_type() == TagType::Mp4Ilst {
        let owned = std::mem::replace(tag, Tag::new(TagType::Mp4Ilst));
        let mut native = Ilst::from(owned);
        native.remove(&AtomIdent::Fourcc(*b"tmpo")).for_each(drop);
        *tag = native.into();
    }
}
