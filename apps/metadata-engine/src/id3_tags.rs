//! ID3 frames whose identity or value is lost in generic tag conversion.

use lofty::{
    id3::v2::{Frame, Id3v2Tag},
    tag::Tag,
};

#[derive(Default)]
pub struct Id3Snapshot(Id3v2Tag);

impl Id3Snapshot {
    pub fn take(tag: Option<&mut Id3v2Tag>) -> Self {
        let mut preserved = Id3v2Tag::new();
        if let Some(tag) = tag {
            tag.retain(|frame| {
                let custom = match frame {
                    Frame::UserText(text) => text.description.len() == 4,
                    Frame::UserUrl(url) => url.description.len() == 4,
                    _ => false,
                };
                if custom || matches!(frame, Frame::Popularimeter(_)) {
                    preserved.insert(frame.clone());
                }
                // A TXXX named TIT2 is independent of the standard title frame.
                // Ratings may remain in the generic view; save restores their exact values.
                !custom
            });
        }
        Self(preserved)
    }

    pub fn read_custom(&self) -> Vec<(String, String)> {
        (&self.0)
            .into_iter()
            .filter_map(|frame| match frame {
                Frame::UserText(text) => Some((&text.description, &text.content)),
                Frame::UserUrl(url) => Some((&url.description, &url.content)),
                _ => None,
            })
            .flat_map(|(name, value)| {
                value
                    .split('\0')
                    .map(move |value| (name.to_string(), value.to_owned()))
            })
            .collect()
    }

    pub fn remove_aliases(&mut self, canonical: &str, aliases: &[&str]) {
        self.0.retain(|frame| {
            let name = match frame {
                Frame::UserText(text) => &text.description,
                Frame::UserUrl(url) => &url.description,
                _ => return true,
            };
            !name.eq_ignore_ascii_case(canonical)
                && !aliases.iter().any(|alias| name.eq_ignore_ascii_case(alias))
        });
    }

    pub fn merge(&self, tag: &Tag) -> Id3v2Tag {
        let mut merged = Id3v2Tag::from(tag.clone());
        merged.retain(|frame| !matches!(frame, Frame::Popularimeter(_)));
        for frame in &self.0 {
            merged.insert(frame.clone());
        }
        merged
    }
}
