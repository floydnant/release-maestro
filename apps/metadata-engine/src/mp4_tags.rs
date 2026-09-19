//! Preserve native MP4 values that generic tag conversion cannot represent.
use crate::custom_tags::LegacyField;
use lofty::{
    mp4::{Atom, AtomData, AtomIdent, DataType, Ilst},
    tag::Tag,
};

/// Keep the original atoms, including values that the generic tag cannot represent.
pub struct Mp4Snapshot {
    original: Ilst,
    baseline: Ilst,
}

impl Mp4Snapshot {
    pub fn new(original: Ilst, tag: &Tag) -> Self {
        Self {
            original,
            baseline: Ilst::from(tag.clone()),
        }
    }

    pub fn original(&self) -> &Ilst {
        &self.original
    }

    pub fn merge(&self, tag: &Tag) -> Ilst {
        let mut edited = Ilst::from(tag.clone());
        let unchanged: Vec<_> = (&self.original)
            .into_iter()
            .filter(|atom| {
                let before: Vec<_> = (&self.baseline)
                    .into_iter()
                    .filter(|candidate| candidate.ident() == atom.ident())
                    .collect();
                let after: Vec<_> = (&edited)
                    .into_iter()
                    .filter(|candidate| candidate.ident() == atom.ident())
                    .collect();
                before == after
            })
            .collect();
        // Replace entire unchanged atoms, preserving every data variant and its order.
        // Changed atoms come from the edited tag, so clears are not resurrected.
        for atom in &unchanged {
            edited.remove(atom.ident()).for_each(drop);
        }
        for atom in &unchanged {
            edited.insert((*atom).clone());
        }
        // A text edit replaces text values, not opaque values sharing the atom.
        // Match canonicalized aliases too; no remaining text means an explicit clear.
        for atom in &self.original {
            if unchanged
                .iter()
                .any(|original| original.ident() == atom.ident())
            {
                continue;
            }
            if !atom
                .data()
                .any(|data| matches!(data, AtomData::UTF8(_) | AtomData::UTF16(_)))
            {
                continue;
            }
            let ident = atom.ident();
            let target = (&edited)
                .into_iter()
                .find(|item| {
                    (item.ident() == ident || same_field(ident, item.ident()))
                        && item
                            .data()
                            .any(|data| matches!(data, AtomData::UTF8(_) | AtomData::UTF16(_)))
                })
                .map(|item| item.ident().clone().into_owned());
            let Some(target) = target else {
                continue;
            };
            let opaque: Vec<_> = (&self.original)
                .into_iter()
                .filter(|item| item.ident() == ident || same_field(item.ident(), &target))
                .flat_map(|item| item.data())
                .filter(|data| !matches!(data, AtomData::UTF8(_) | AtomData::UTF16(_)))
                .collect();
            for (index, value) in opaque.iter().enumerate() {
                let required = opaque[..=index]
                    .iter()
                    .filter(|candidate| *candidate == value)
                    .count();
                let present = (&edited)
                    .into_iter()
                    .filter(|item| item.ident() == &target)
                    .flat_map(|item| item.data())
                    .filter(|candidate| *candidate == *value)
                    .count();
                if present < required {
                    edited.insert(Atom::new(target.clone(), (*value).clone()));
                }
            }
        }
        let mut encoded = Ilst::new();
        for atom in edited {
            let ident = atom.ident().clone().into_owned();
            let data = atom
                .into_data()
                .map(|data| match data {
                    // Lofty writes UTF-8 bytes under the UTF-16 type code.
                    // Supply the correct bytes while retaining the original data type.
                    AtomData::UTF16(text) => AtomData::Unknown {
                        code: DataType::Utf16,
                        data: text.encode_utf16().flat_map(u16::to_be_bytes).collect(),
                    },
                    data => data,
                })
                .collect();
            encoded.insert(Atom::from_collection(ident, data).expect("native atoms contain data"));
        }
        encoded
    }
}

fn same_field(left: &AtomIdent<'_>, right: &AtomIdent<'_>) -> bool {
    match (left, right) {
        (
            AtomIdent::Freeform { mean, name },
            AtomIdent::Freeform {
                mean: other_mean,
                name: other_name,
            },
        ) if mean == "com.apple.iTunes" && mean == other_mean => LegacyField::from_name(name)
            .is_some_and(|field| {
                field
                    .aliases()
                    .iter()
                    .any(|alias| other_name.eq_ignore_ascii_case(alias))
            }),
        _ => false,
    }
}
