//! Custom fields in ID3v2 and MP4 companion tags.
//! Converting back retains the companion tag, including opaque frames and artwork.

use lofty::{
    id3::v2::{Frame, Id3v2Tag},
    iff::wav::RiffInfoList,
    mp4::{Atom, AtomData, AtomIdent, Ilst},
    tag::{ItemKey, Tag, TagType},
};

pub fn is_custom_key(tag_type: TagType, name: &str) -> bool {
    ItemKey::from_key(tag_type, name).is_none()
}

pub fn read(tag: &Tag, mp4: Option<&Ilst>) -> Vec<(String, String)> {
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
            let native = Id3v2Tag::from(tag.clone());
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
        TagType::Mp4Ilst => {
            let native = mp4.cloned().unwrap_or_else(|| Ilst::from(tag.clone()));
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
            let mut native = Id3v2Tag::from(owned);
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
    if tag.tag_type() == TagType::Mp4Ilst {
        let owned = std::mem::replace(tag, Tag::new(TagType::Mp4Ilst));
        let mut native = Ilst::from(owned);
        native.remove(&AtomIdent::Fourcc(*b"tmpo")).for_each(drop);
        *tag = native.into();
    }
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

    pub fn replace(
        self,
        tag: &mut Tag,
        native: &mut crate::native_tags::NativeTags,
        value: Option<String>,
    ) -> Result<(), String> {
        let aliases = self.aliases();
        native.replace_text(tag, aliases[0], &aliases[1..], value)
    }
}

/// Remove legacy fields only when an explicit edit targets them.
pub fn remove_riff_aliases(
    mut native: RiffInfoList,
    fields: &[LegacyField],
) -> Option<RiffInfoList> {
    let names: Vec<_> = (&native)
        .into_iter()
        .filter(|(name, _)| {
            fields.iter().any(|field| {
                field
                    .aliases()
                    .iter()
                    .any(|alias| name.eq_ignore_ascii_case(alias))
            })
        })
        .map(|(name, _)| name.clone())
        .collect();
    if names.is_empty() {
        return None;
    }
    for name in names {
        native.remove(&name);
    }
    Some(native)
}
