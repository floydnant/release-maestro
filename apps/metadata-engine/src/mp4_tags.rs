//! Preserve native MP4 values that generic tag conversion cannot represent.
use lofty::{
    mp4::{Atom, AtomData, DataType, Ilst},
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
        for atom in unchanged {
            edited.insert(atom.clone());
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
