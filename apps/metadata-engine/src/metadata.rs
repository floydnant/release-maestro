use crate::{constants::separator, image_format::ImageFormat};
use lofty::{
    config::WriteOptions,
    file::{AudioFile, FileType, TaggedFile, TaggedFileExt},
    read_from_path,
    tag::{Accessor, ItemKey, ItemValue, Tag, TagItem, TagType},
};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, time::SystemTime};

type NullableField<T> = Option<Option<T>>;

fn deserialize_nullable_field<'de, D, T>(deserializer: D) -> Result<NullableField<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

trait ToFormattedExt {
    fn to_formatted(&self) -> String;
}

impl ToFormattedExt for FileType {
    fn to_formatted(&self) -> String {
        match self {
            FileType::Flac => "FLAC".to_string(),
            FileType::Mpeg => "MPEG".to_string(),
            FileType::Aiff => "AIFF".to_string(),
            FileType::Wav => "WAV".to_string(),
            FileType::Ape => "APE".to_string(),
            FileType::Opus => "Opus".to_string(),
            FileType::Speex => "Speex".to_string(),
            FileType::Vorbis => "Vorbis".to_string(),
            FileType::Aac => "AAC".to_string(),
            FileType::Mp4 => "MP4".to_string(),
            FileType::Mpc => "MPC".to_string(),
            FileType::WavPack => "WavPack".to_string(),
            FileType::Custom(custom_type) => format!("Custom: {}", custom_type),
            _ => "Unknown".to_string(),
        }
    }
}

impl ToFormattedExt for TagType {
    fn to_formatted(&self) -> String {
        match self {
            TagType::VorbisComments => "Vorbis".to_string(),
            TagType::Id3v1 => "ID3v1".to_string(),
            TagType::Id3v2 => "ID3v2".to_string(),
            TagType::Ape => "APE".to_string(),
            TagType::Mp4Ilst => "MP4 ILST".to_string(),
            TagType::RiffInfo => "RIFF Info".to_string(),
            TagType::AiffText => "AIFF Text".to_string(),
            _ => format!("{:?}", self),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    /// in seconds
    pub duration: f64,
    overall_bitrate: Option<u32>,
    audio_bitrate: Option<u32>,
    sample_rate: Option<u32>,
    bit_depth: Option<u8>,
    pub channels: Option<u8>,
    tag_type: Option<String>,
    codec: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SongMetadata {
    pub title: String,
    pub artist: Option<String>,
    pub album_title: Option<String>,
    pub album_artist: Option<String>,
    pub cover_path: Option<String>,
    pub year: Option<i32>,
    pub track: Option<u16>,
    pub genre: Option<String>,
    pub label: Option<String>,
    pub catalog_number: Option<String>,
    pub duration: Option<f64>,
    pub comment: Option<String>,
    pub musical_key: Option<String>,
    pub bpm: Option<f64>,
    pub energy: Option<String>,
    pub lyrics: Option<String>,
    pub date: Option<String>,
    pub extra_metadata: Vec<(String, String)>,
    pub file_info: Option<FileInfo>,
    pub file_name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u128>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SongMetadataUpdateable {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub artist: NullableField<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub album_title: NullableField<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub album_artist: NullableField<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub year: NullableField<i32>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub track: NullableField<u16>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub genre: NullableField<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub comment: NullableField<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub date: NullableField<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub label: NullableField<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub catalog_number: NullableField<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub musical_key: NullableField<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub bpm: NullableField<f64>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub energy: NullableField<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    pub lyrics: NullableField<String>,
    pub file_name: Option<String>,
}

fn format_item_key(key: &ItemKey) -> String {
    match key {
        ItemKey::Unknown(ref_key) => format!("Custom: {ref_key}"),
        _ => format!("{:?}", key),
    }
}

/// Lowercase hex SHA-256 of the given bytes, used to content-address cached cover art.
fn hex_digest(bytes: &[u8]) -> String {
    let hash = Sha256::digest(bytes);
    let mut out = String::with_capacity(hash.len() * 2);
    for byte in hash {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

fn get_first_image_in_folder(folder_path: &str) -> Option<String> {
    let file_path = match fs::read_dir(folder_path) {
        Err(_) => None,
        Ok(mut files) => {
            let first_image_file = files.find(|file| {
                file.as_ref().ok().is_some_and(|file| {
                    file.file_name()
                        .into_string()
                        .ok()
                        .and_then(|filename| ImageFormat::from_file_name(&filename))
                        .is_some()
                })
            });

            match first_image_file {
                Some(file) => {
                    let filename = file
                        .map(|f| f.file_name().into_string().ok())
                        .unwrap_or(None)?;
                    Some(format!("{}{}{}", folder_path, separator(), filename))
                }
                None => None,
            }
        }
    };

    file_path
}

fn get_or_create_primary_tag(tagged_file: &mut TaggedFile) -> Result<&mut Tag, String> {
    if tagged_file.primary_tag().is_none() {
        let tag_type = match tagged_file.file_type() {
            FileType::Flac
            | FileType::Opus
            | FileType::Speex
            | FileType::Vorbis
            | FileType::Mpc
            | FileType::WavPack => TagType::VorbisComments,
            FileType::Mpeg => TagType::Id3v2,
            FileType::Aac | FileType::Mp4 => TagType::Mp4Ilst,
            FileType::Ape => TagType::Ape,
            FileType::Wav => TagType::RiffInfo,
            FileType::Aiff => TagType::AiffText,
            FileType::Custom(_) | _ => {
                return Err(format!(
                    "Unsupported file type for metadata writing {:?}",
                    tagged_file.file_type()
                ));
            }
        };

        tagged_file.insert_tag(Tag::new(tag_type));
    }

    tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "Failed to create primary tag".to_string())
}

fn normalize_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim().to_string();
        (!value.is_empty()).then_some(value)
    })
}

fn apply_item_key_update(tag: &mut Tag, key: ItemKey, update: NullableField<String>) -> bool {
    match update {
        Some(value) => {
            match normalize_text(value) {
                Some(value) => {
                    tag.insert_text(key.clone(), value);
                }
                None => {
                    tag.remove_key(&key);
                }
            }
            true
        }
        None => false,
    }
}

fn remove_unknown_text_aliases(tag: &mut Tag, aliases: &[&str]) {
    tag.retain(|item| {
        let ItemKey::Unknown(key) = item.key() else {
            return true;
        };

        !aliases.iter().any(|alias| key.eq_ignore_ascii_case(alias))
    });
}

fn apply_item_key_update_with_alias_removal(
    tag: &mut Tag,
    key: ItemKey,
    aliases: &[&str],
    update: NullableField<String>,
) -> bool {
    match update {
        Some(value) => {
            remove_unknown_text_aliases(tag, aliases);

            match normalize_text(value) {
                Some(value) => {
                    tag.insert_text(key.clone(), value);
                }
                None => {
                    tag.remove_key(&key);
                }
            }

            true
        }
        None => false,
    }
}

fn remove_item_keys(tag: &mut Tag, keys: &[ItemKey]) {
    for key in keys {
        tag.remove_key(key);
    }
}

fn normalize_bpm_value(value: f64) -> Result<f64, String> {
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("Invalid BPM value '{value}'"));
    }

    Ok((value * 1000.0).round() / 1000.0)
}

fn format_bpm_value(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        return format!("{}", value.round() as u32);
    }

    let mut formatted = format!("{value:.3}");
    while formatted.contains('.') && formatted.ends_with('0') {
        formatted.pop();
    }
    if formatted.ends_with('.') {
        formatted.pop();
    }

    formatted
}

fn parse_bpm_value(value: &str) -> Option<f64> {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .and_then(|parsed| normalize_bpm_value(parsed).ok())
}

fn apply_bpm_update(tag: &mut Tag, update: NullableField<f64>) -> Result<bool, String> {
    match update {
        Some(value) => {
            remove_item_keys(tag, &[ItemKey::Bpm, ItemKey::IntegerBpm]);

            if let Some(value) = value {
                let normalized_bpm = normalize_bpm_value(value)?;
                let integer_bpm = normalized_bpm.round() as u32;

                tag.insert_text(ItemKey::Bpm, format_bpm_value(normalized_bpm));
                tag.insert_text(ItemKey::IntegerBpm, integer_bpm.to_string());
            }

            Ok(true)
        }
        None => Ok(false),
    }
}

fn apply_energy_update(tag: &mut Tag, update: NullableField<String>) -> bool {
    const ENERGY_KEYS: &[&str] = &["ENERGY", "ENERGYLEVEL", "Energylevel", "EnergyLevel"];

    match update {
        Some(value) => {
            remove_unknown_text_aliases(tag, ENERGY_KEYS);

            if let Some(value) = normalize_text(value) {
                tag.insert_unchecked(TagItem::new(
                    ItemKey::Unknown("ENERGY".to_string()),
                    ItemValue::Text(value),
                ));
            }

            true
        }
        None => false,
    }
}

fn rename_file(path: &str, new_file_name: &str) -> Result<String, String> {
    let new_file_name = new_file_name.trim();
    if new_file_name.is_empty() {
        return Err("File name cannot be empty".to_string());
    }

    let current_path = Path::new(path);
    let current_file_name = current_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Failed to read current file name".to_string())?;

    if current_file_name == new_file_name {
        return Ok(path.to_string());
    }

    let new_path = current_path.with_file_name(new_file_name);
    fs::rename(current_path, &new_path).map_err(|error| {
        format!(
            "Failed to rename file to '{}': {}",
            new_path.display(),
            error
        )
    })?;

    Ok(new_path.to_string_lossy().into_owned())
}

pub fn update_song_metadata(
    path: &str,
    song: SongMetadataUpdateable,
    cover_art_cache_dir: String,
) -> Result<SongMetadata, String> {
    let file_path = Path::new(path);
    let mut tagged_file =
        read_from_path(file_path).map_err(|error| format!("Failed to read file: {}", error))?;
    let tag = get_or_create_primary_tag(&mut tagged_file)?;
    let mut has_changes = false;

    if let Some(title) = song.title {
        let title = title.trim().to_string();
        if title.is_empty() {
            tag.remove_title();
        } else {
            tag.set_title(title);
        }
        has_changes = true;
    }

    if let Some(artist) = song.artist {
        match normalize_text(artist) {
            Some(artist) => tag.set_artist(artist),
            None => tag.remove_artist(),
        }
        has_changes = true;
    }

    if let Some(album_title) = song.album_title {
        match normalize_text(album_title) {
            Some(album_title) => tag.set_album(album_title),
            None => tag.remove_album(),
        }
        has_changes = true;
    }

    has_changes |= apply_item_key_update(tag, ItemKey::AlbumArtist, song.album_artist);

    if let Some(year) = song.year {
        match year {
            Some(year) => tag.set_year(year as u32),
            None => tag.remove_year(),
        }
        has_changes = true;
    }

    if let Some(track) = song.track {
        match track {
            Some(track) => tag.set_track(track as u32),
            None => tag.remove_track(),
        }
        has_changes = true;
    }

    if let Some(genre) = song.genre {
        match normalize_text(genre) {
            Some(genre) => tag.set_genre(genre),
            None => tag.remove_genre(),
        }
        has_changes = true;
    }

    has_changes |=
        apply_item_key_update_with_alias_removal(tag, ItemKey::Comment, &["COMMENT"], song.comment);

    if let Some(date) = song.date {
        match normalize_text(date) {
            Some(date) => {
                tag.insert_text(ItemKey::ReleaseDate, date);
            }
            None => remove_item_keys(tag, &[ItemKey::ReleaseDate, ItemKey::RecordingDate]),
        }
        has_changes = true;
    }

    has_changes |= apply_item_key_update(tag, ItemKey::Label, song.label);
    has_changes |= apply_item_key_update(tag, ItemKey::CatalogNumber, song.catalog_number);
    has_changes |= apply_item_key_update(tag, ItemKey::InitialKey, song.musical_key);
    has_changes |=
        apply_item_key_update_with_alias_removal(tag, ItemKey::Lyrics, &["LYRICS"], song.lyrics);
    has_changes |= apply_bpm_update(tag, song.bpm)?;
    has_changes |= apply_energy_update(tag, song.energy);

    if has_changes {
        tagged_file
            .save_to_path(file_path, WriteOptions::new().remove_others(false))
            .map_err(|error| format!("Failed to save file: {}", error))?;
    }

    let final_path = if let Some(file_name) = song.file_name {
        rename_file(path, &file_name)?
    } else {
        path.to_string()
    };

    read_song_metadata_v2(Path::new(&final_path), cover_art_cache_dir)
        .ok_or_else(|| format!("Failed to reload updated metadata from {final_path}"))
}

// @TODO: report errors instead of silently returning None, and handle them properly in the UI.
pub fn read_song_metadata_v2(
    file_path: &Path,
    cover_art_cache_dir: String,
) -> Option<SongMetadata> {
    // Its fair to assume that if the metadata cannot be read,
    // the file does not exist or cannot be accessed anyway
    let metadata = fs::metadata(file_path).ok()?;
    let created_at = metadata.created().ok().and_then(|time| {
        time.duration_since(SystemTime::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_millis())
    });

    if let Some(extension) = file_path.extension() {
        if let Some(ext_str) = extension.to_str() {
            // @TODO: does this check for formats need to be extended?
            if ext_str.eq_ignore_ascii_case("mp3")
                || ext_str.eq_ignore_ascii_case("flac")
                || ext_str.eq_ignore_ascii_case("wav")
                || ext_str.eq_ignore_ascii_case("aiff")
                || ext_str.eq_ignore_ascii_case("aif")
                || ext_str.eq_ignore_ascii_case("ape")
                || ext_str.eq_ignore_ascii_case("ogg")
            // || ext_str.eq_ignore_ascii_case("opus")
            {
                if let Ok(tagged_file) = read_from_path(file_path) {
                    // let id = MD5::hash(file_path.to_str().unwrap().as_bytes()).to_hex_lowercase();
                    let path = file_path.to_string_lossy().into_owned();
                    let file_name = file_path.file_name()?.to_string_lossy().into_owned();

                    let file_info = FileInfo {
                        duration: tagged_file.properties().duration().as_secs_f64(),
                        channels: tagged_file.properties().channels(),
                        bit_depth: tagged_file.properties().bit_depth().or(Some(16)),
                        sample_rate: tagged_file.properties().sample_rate(),
                        audio_bitrate: tagged_file.properties().audio_bitrate(),
                        overall_bitrate: tagged_file.properties().overall_bitrate(),
                        tag_type: if let Some(tag) = tagged_file.primary_tag() {
                            Some(tag.tag_type().to_formatted())
                        } else {
                            match tagged_file.file_type() {
                                FileType::Flac | FileType::Wav | FileType::Vorbis => {
                                    Some("Vorbis".to_string())
                                }
                                FileType::Mpeg => Some("ID3v2".to_string()),
                                FileType::Ape | FileType::Opus | FileType::Speex => None,
                                _ => None,
                            }
                        },
                        codec: tagged_file.file_type().to_formatted(),
                    };

                    let mut title = None;
                    let mut artist = None;
                    let mut album_title = None;
                    let mut album_artist = None;
                    let mut track_number = None;
                    let mut comment = None;
                    let mut year = None;
                    let mut date = None;
                    let mut genre = None;
                    let mut label = None;
                    let mut catalog_number = None;
                    let mut key = None;
                    let mut bpm = None;
                    let mut energy = None;
                    let mut lyrics = None;
                    let mut extra_metadata_tags: Vec<(String, String)> = Vec::new();
                    let primary_tag = tagged_file.primary_tag();
                    let has_primary_tag = primary_tag.is_some();

                    let mut apply_tag = |tag: &Tag, allow_overwrite: bool| {
                        tag.items().for_each(|item| match item.key() {
                            ItemKey::TrackTitle => {
                                if allow_overwrite || (!has_primary_tag && title.is_none()) {
                                    title = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::TrackArtist => {
                                if allow_overwrite || (!has_primary_tag && artist.is_none()) {
                                    artist = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::AlbumTitle => {
                                if allow_overwrite || (!has_primary_tag && album_title.is_none()) {
                                    album_title = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::AlbumArtist => {
                                if allow_overwrite || (!has_primary_tag && album_artist.is_none()) {
                                    album_artist = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::Genre => {
                                if allow_overwrite || (!has_primary_tag && genre.is_none()) {
                                    genre = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::Comment => {
                                if allow_overwrite || (!has_primary_tag && comment.is_none()) {
                                    comment = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::Lyrics => {
                                if allow_overwrite || (!has_primary_tag && lyrics.is_none()) {
                                    lyrics = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::Year => {
                                if allow_overwrite || (!has_primary_tag && year.is_none()) {
                                    year = item
                                        .value()
                                        .to_owned()
                                        .into_string()
                                        .and_then(|s| s.parse::<i32>().ok());
                                }
                            }
                            ItemKey::ReleaseDate | ItemKey::RecordingDate => {
                                if allow_overwrite || (!has_primary_tag && date.is_none()) {
                                    date = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::TrackNumber => {
                                if allow_overwrite || (!has_primary_tag && track_number.is_none()) {
                                    track_number = item
                                        .value()
                                        .to_owned()
                                        .into_string()
                                        .and_then(|s| s.parse::<u16>().ok());
                                }
                            }
                            ItemKey::CatalogNumber => {
                                if allow_overwrite || (!has_primary_tag && catalog_number.is_none())
                                {
                                    catalog_number = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::Label => {
                                if allow_overwrite || (!has_primary_tag && label.is_none()) {
                                    label = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::InitialKey => {
                                if allow_overwrite || (!has_primary_tag && key.is_none()) {
                                    key = item.value().to_owned().into_string();
                                }
                            }
                            ItemKey::Bpm | ItemKey::IntegerBpm => {
                                if allow_overwrite || (!has_primary_tag && bpm.is_none()) {
                                    bpm = item
                                        .value()
                                        .to_owned()
                                        .into_string()
                                        .and_then(|value| parse_bpm_value(&value));
                                }
                            }
                            ItemKey::Unknown(field_name) => match field_name.as_str() {
                                "ENERGY" | "ENERGYLEVEL" | "Energylevel" | "EnergyLevel" => {
                                    if energy.is_none() {
                                        energy = item.value().to_owned().into_string();
                                    }
                                }
                                "BPM" | "TBPM" | "Bpm" | "bpm" => {
                                    if bpm.is_none() {
                                        bpm = item
                                            .value()
                                            .to_owned()
                                            .into_string()
                                            .and_then(|value| parse_bpm_value(&value));
                                    }
                                }
                                "KEY" | "TKEY" | "INITIALKEY" | "INITIAL KEY" | "Initial key" => {
                                    if key.is_none() {
                                        key = item.value().to_owned().into_string();
                                    }
                                }
                                "COMMENT" | "Comment" | "comment" => {
                                    if comment.is_none() {
                                        comment = item.value().to_owned().into_string();
                                    }
                                }
                                "CATALOGUENUMBER" | "CATALOGID" | "CATALOG" | "Catalog"
                                | "CATALOG NUMBER" | "Catalog ID" | "CATALOG #" | "Catalog #"
                                | "CAT#" => {
                                    if catalog_number.is_none() {
                                        catalog_number = item.value().to_owned().into_string();
                                    }
                                }
                                "LYRICS" => {
                                    if lyrics.is_none() {
                                        lyrics = item.value().to_owned().into_string();
                                    }
                                }
                                unknown_field_name => {
                                    extra_metadata_tags.push((
                                        format_item_key(&ItemKey::Unknown(
                                            unknown_field_name.to_string(),
                                        )),
                                        item.value().to_owned().into_string().unwrap_or_default(),
                                    ));
                                }
                            },
                            item_key => {
                                extra_metadata_tags.push((
                                    format_item_key(item_key),
                                    item.value().to_owned().into_string().unwrap_or_default(),
                                ));
                            }
                        });
                    };

                    if let Some(primary_tag) = primary_tag {
                        apply_tag(primary_tag, true);
                    }

                    tagged_file.tags().iter().for_each(|tag| {
                        if primary_tag.is_some_and(|primary_tag| std::ptr::eq(primary_tag, tag)) {
                            return;
                        }

                        apply_tag(tag, false);
                    });

                    let cover_path = tagged_file
                        .primary_tag()
                        .and_then(|tag| {
                            tag.pictures().first().and_then(|cover| {
                                let file_ext: Option<&str> = cover.mime_type().and_then(|mime| {
                                    ImageFormat::from_lofty_mimetype(mime.clone())
                                        .map(|format| format.extension())
                                });
                                if file_ext.is_none() {
                                    eprintln!(
                                        "Unsupported or missing MIME type for cover art in {}: {:?}",
                                        path, cover.mime_type()
                                    );
                                    return None;
                                }

                                // Content-addressed filename: derived from the image bytes
                                // rather than the song's file name. This avoids collisions
                                // between same-named files in different folders and lets
                                // identical artwork dedupe to a single cache entry.
                                let digest = hex_digest(cover.data());
                                let cover_path = format!(
                                    "{}{}{}.{}",
                                    cover_art_cache_dir,
                                    separator(),
                                    digest,
                                    file_ext.unwrap()
                                );

                                // Identical bytes always hash to the same path, so an
                                // existing file is guaranteed to hold the same artwork.
                                if Path::new(&cover_path).exists() {
                                    return Some(cover_path);
                                }

                                match fs::write(cover_path.clone(), cover.data()) {
                                    Ok(_) => Some(cover_path),
                                    Err(err) => {
                                        eprintln!(
                                            "Failed to write cover art to {}: {:?}",
                                            cover_path, err
                                        );
                                        None
                                    }
                                }
                            })
                        })
                        .or_else(|| {
                            Path::new(&path)
                                .parent()
                                .and_then(|folder| folder.to_str())
                                .and_then(get_first_image_in_folder)
                        });

                    return Some(SongMetadata {
                        path,
                        file_name: file_name.clone(),
                        title: title.unwrap_or(file_name),
                        artist,
                        album_title,
                        album_artist,
                        year,
                        genre,
                        label,
                        catalog_number,
                        track: track_number,
                        duration: Some(file_info.duration),
                        file_info: Some(file_info),
                        cover_path,
                        comment,
                        musical_key: key,
                        bpm,
                        lyrics,
                        energy,
                        date,
                        extra_metadata: extra_metadata_tags,
                        created_at,
                    });
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        apply_energy_update, apply_item_key_update_with_alias_removal, hex_digest, FileInfo,
        SongMetadata, SongMetadataUpdateable,
    };
    use lofty::tag::{ItemKey, Tag, TagType};

    #[test]
    fn deserializes_missing_and_null_fields_differently() {
        let cleared: SongMetadataUpdateable = serde_json::from_str(r#"{"artist":null,"bpm":null}"#)
            .expect("should deserialize nulls");
        let omitted: SongMetadataUpdateable =
            serde_json::from_str(r#"{}"#).expect("should deserialize empty payload");
        let set_value: SongMetadataUpdateable =
            serde_json::from_str(r#"{"artist":"A","bpm":128}"#).expect("should deserialize values");

        assert_eq!(cleared.artist, Some(None));
        assert_eq!(cleared.bpm, Some(None));

        assert_eq!(omitted.artist, None);
        assert_eq!(omitted.bpm, None);

        assert_eq!(set_value.artist, Some(Some("A".to_string())));
        assert_eq!(set_value.bpm, Some(Some(128.0)));
    }

    #[test]
    fn serializes_and_deserializes_musical_key_wire_name() {
        let metadata = SongMetadata {
            title: "Song".to_string(),
            artist: None,
            album_title: None,
            album_artist: None,
            cover_path: None,
            year: None,
            track: None,
            genre: None,
            label: None,
            catalog_number: None,
            duration: None,
            comment: None,
            musical_key: Some("Am".to_string()),
            bpm: None,
            energy: None,
            lyrics: None,
            date: None,
            extra_metadata: vec![],
            file_info: Some(FileInfo {
                duration: 123.0,
                overall_bitrate: None,
                audio_bitrate: None,
                sample_rate: None,
                bit_depth: None,
                channels: None,
                tag_type: None,
                codec: "FLAC".to_string(),
            }),
            file_name: "song.flac".to_string(),
            path: "/music/song.flac".to_string(),
            created_at: None,
        };

        let serialized = serde_json::to_value(metadata).expect("should serialize metadata");
        assert_eq!(serialized["musicalKey"], "Am");
        assert!(serialized.get("key").is_none());

        let update: SongMetadataUpdateable =
            serde_json::from_str(r#"{"musicalKey":"Gm"}"#).expect("should deserialize update");
        assert_eq!(update.musical_key, Some(Some("Gm".to_string())));
    }

    #[test]
    fn comment_and_lyrics_updates_remove_legacy_alias_items() {
        let mut tag = Tag::new(TagType::Id3v2);
        tag.insert_text(
            ItemKey::Unknown("COMMENT".to_string()),
            "legacy comment".to_string(),
        );
        tag.insert_text(
            ItemKey::Unknown("LYRICS".to_string()),
            "legacy lyrics".to_string(),
        );

        assert!(apply_item_key_update_with_alias_removal(
            &mut tag,
            ItemKey::Comment,
            &["COMMENT"],
            Some(Some("fresh comment".to_string())),
        ));
        assert!(apply_item_key_update_with_alias_removal(
            &mut tag,
            ItemKey::Lyrics,
            &["LYRICS"],
            Some(None),
        ));

        assert_eq!(tag.get_string(&ItemKey::Comment), Some("fresh comment"));
        assert_eq!(tag.get_string(&ItemKey::Lyrics), None);
        assert_eq!(
            tag.get_string(&ItemKey::Unknown("COMMENT".to_string())),
            None
        );
        assert_eq!(
            tag.get_string(&ItemKey::Unknown("LYRICS".to_string())),
            None
        );
    }

    #[test]
    fn energy_update_replaces_legacy_aliases() {
        let mut tag = Tag::new(TagType::Id3v2);
        tag.insert_text(ItemKey::Unknown("EnergyLevel".to_string()), "3".to_string());
        tag.insert_text(ItemKey::Unknown("ENERGYLEVEL".to_string()), "5".to_string());

        assert!(apply_energy_update(&mut tag, Some(Some("8".to_string()))));

        assert_eq!(
            tag.get_string(&ItemKey::Unknown("ENERGY".to_string())),
            Some("8")
        );
        assert_eq!(
            tag.get_string(&ItemKey::Unknown("EnergyLevel".to_string())),
            None
        );
        assert_eq!(
            tag.get_string(&ItemKey::Unknown("ENERGYLEVEL".to_string())),
            None
        );
    }

    #[test]
    fn hex_digest_is_deterministic_and_content_addressed() {
        // Known SHA-256 of the empty input, pinned so the cache layout is stable.
        assert_eq!(
            hex_digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );

        // Same bytes always hash to the same name (enables dedupe + skip-write);
        // different bytes must not collide.
        assert_eq!(hex_digest(b"cover-bytes"), hex_digest(b"cover-bytes"));
        assert_ne!(hex_digest(b"cover-a"), hex_digest(b"cover-b"));

        // Always lowercase hex of a 32-byte digest.
        let digest = hex_digest(b"anything");
        assert_eq!(digest.len(), 64);
        assert!(digest
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }
}
