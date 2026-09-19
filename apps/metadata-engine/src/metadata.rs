use crate::custom_tags::{read_from_path, LegacyField};
use crate::{constants::separator, custom_tags, image_format::ImageFormat};
use lofty::{
    file::{AudioFile, FileType, TaggedFile, TaggedFileExt},
    tag::{Accessor, ItemKey, Tag, TagType},
};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::{fmt, fs, io, path::Path, time::SystemTime};

type NullableField<T> = Option<Option<T>>;

const LOFTY_SUPPORTED_AUDIO_EXTENSIONS: &[&str] = &[
    "3gp", "aac", "afc", "aif", "aifc", "aiff", "ape", "flac", "m4a", "m4b", "m4p", "m4r", "m4v",
    "mp+", "mp1", "mp2", "mp3", "mp4", "mpc", "mpp", "ogg", "opus", "spx", "wav", "wave", "wv",
];

const AUDIO_FILE_EXTENSIONS: &[&str] = &[
    "3ga", "3gp", "4mp", "669", "8svx", "aa", "aac", "aax", "ac3", "act", "adp", "adt", "adts",
    "afc", "aif", "aifc", "aiff", "alac", "amr", "ape", "apl", "au", "awb", "caf", "cda", "dff",
    "dsf", "dts", "dtshd", "eac3", "flac", "gsm", "it", "kar", "la", "m4a", "m4b", "m4p", "m4r",
    "m4v", "mid", "midi", "mka", "mlp", "mod", "mogg", "mp+", "mp1", "mp2", "mp3", "mp4", "mpa",
    "mpc", "mpp", "msv", "oga", "ogg", "oma", "opus", "ra", "ram", "rf64", "s3m", "sid", "snd",
    "spx", "tak", "tta", "voc", "vox", "vqf", "wav", "wave", "wma", "wv", "xm",
];

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadSongMetadataError {
    FileNotFound {
        path: String,
    },
    FileMetadataReadFailed {
        path: String,
        message: String,
    },
    UnsupportedFormat {
        path: String,
        extension: Option<String>,
    },
    NotAnAudioFile {
        path: String,
        extension: Option<String>,
    },
    MetadataParseFailed {
        path: String,
        message: String,
    },
    FileNameMissing {
        path: String,
    },
}

impl fmt::Display for ReadSongMetadataError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadSongMetadataError::FileNotFound { path: _ } => {
                write!(formatter, "File not found")
            }
            ReadSongMetadataError::FileMetadataReadFailed { path: _, message } => {
                write!(formatter, "Failed to read file metadata: {message}")
            }
            ReadSongMetadataError::UnsupportedFormat { path: _, extension } => {
                let extension = extension.as_deref().unwrap_or("none");
                write!(formatter, "Unsupported audio format: {extension}")
            }
            ReadSongMetadataError::MetadataParseFailed { path: _, message } => {
                write!(formatter, "Failed to read file metadata: {message}")
            }
            ReadSongMetadataError::FileNameMissing { path: _ } => {
                write!(formatter, "Failed to read file name")
            }
            ReadSongMetadataError::NotAnAudioFile { path: _, extension } => {
                let extension = extension.as_deref().unwrap_or("none");
                write!(formatter, "Not an audio file (extension: {extension})")
            }
        }
    }
}

impl std::error::Error for ReadSongMetadataError {}

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

pub(crate) fn is_audio_file_extension(extension: Option<&str>) -> bool {
    extension_matches(extension, AUDIO_FILE_EXTENSIONS)
}

pub(crate) fn is_supported_audio_file_extension(extension: Option<&str>) -> bool {
    extension_matches(extension, LOFTY_SUPPORTED_AUDIO_EXTENSIONS)
}

fn extension_matches(extension: Option<&str>, supported_extensions: &[&str]) -> bool {
    extension.is_some_and(|extension| {
        let extension = extension.to_ascii_lowercase();
        supported_extensions.contains(&extension.as_str())
    })
}

fn get_or_create_primary_tag(tagged_file: &mut TaggedFile) -> Result<&mut Tag, String> {
    if tagged_file.primary_tag().is_none() {
        let tag_type = tagged_file.primary_tag_type();

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

fn apply_item_key_update_with_alias_removal(
    tag: &mut Tag,
    key: ItemKey,
    field: LegacyField,
    update: NullableField<String>,
) -> Result<bool, String> {
    match update {
        Some(value) => {
            field.replace(tag, None)?;

            match normalize_text(value) {
                Some(value) => {
                    tag.insert_text(key.clone(), value);
                }
                None => {
                    tag.remove_key(&key);
                }
            }

            Ok(true)
        }
        None => Ok(false),
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
            custom_tags::remove_bpm(tag).map_err(|error| error.to_string())?;
            remove_item_keys(tag, &[ItemKey::Bpm, ItemKey::IntegerBpm]);

            if let Some(value) = value {
                let normalized_bpm = normalize_bpm_value(value)?;
                let integer_bpm = normalized_bpm.round() as u32;

                let value = format_bpm_value(normalized_bpm);
                if ItemKey::Bpm.map_key(tag.tag_type(), false).is_some() {
                    tag.insert_text(ItemKey::Bpm, value);
                } else {
                    LegacyField::Bpm.replace(tag, Some(value))?;
                }
                if ItemKey::IntegerBpm.map_key(tag.tag_type(), false).is_some() {
                    tag.insert_text(ItemKey::IntegerBpm, integer_bpm.to_string());
                }
            }

            Ok(true)
        }
        None => Ok(false),
    }
}

fn apply_energy_update(tag: &mut Tag, update: NullableField<String>) -> Result<bool, String> {
    match update {
        Some(value) => {
            LegacyField::Energy.replace(tag, normalize_text(value))?;
            Ok(true)
        }
        None => Ok(false),
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
    fs::rename(current_path, &new_path)
        .map_err(|error| format!("Failed to rename file: {}", error))?;

    Ok(new_path.to_string_lossy().into_owned())
}

// @TODO: report proper errors instead of using string messages
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

    has_changes |= apply_item_key_update_with_alias_removal(
        tag,
        ItemKey::Comment,
        LegacyField::Comment,
        song.comment,
    )?;

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
    has_changes |= apply_item_key_update_with_alias_removal(
        tag,
        ItemKey::CatalogNumber,
        LegacyField::CatalogNumber,
        song.catalog_number,
    )?;
    has_changes |= apply_item_key_update_with_alias_removal(
        tag,
        ItemKey::InitialKey,
        LegacyField::MusicalKey,
        song.musical_key,
    )?;
    has_changes |= apply_item_key_update_with_alias_removal(
        tag,
        ItemKey::Lyrics,
        LegacyField::Lyrics,
        song.lyrics,
    )?;
    has_changes |= apply_bpm_update(tag, song.bpm)?;
    has_changes |= apply_energy_update(tag, song.energy)?;

    if has_changes {
        custom_tags::save(tag, file_path)
            .map_err(|error| format!("Failed to save file: {}", error))?;
    }

    let final_path = if let Some(file_name) = song.file_name {
        rename_file(path, &file_name)?
    } else {
        path.to_string()
    };

    read_song_metadata_v2(Path::new(&final_path), cover_art_cache_dir)
        .map_err(|error| format!("Failed to reload updated metadata: {error}"))
}

pub fn read_song_metadata_v2(
    file_path: &Path,
    cover_art_cache_dir: String,
) -> Result<SongMetadata, ReadSongMetadataError> {
    let path = file_path.to_string_lossy().into_owned();
    let metadata = fs::metadata(file_path).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => ReadSongMetadataError::FileNotFound { path: path.clone() },
        _ => ReadSongMetadataError::FileMetadataReadFailed {
            path: path.clone(),
            message: error.to_string(),
        },
    })?;
    let created_at = metadata.created().ok().and_then(|time| {
        time.duration_since(SystemTime::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_millis())
    });

    let tagged_file = read_from_path(file_path).map_err(|error| {
        let extension = file_path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_string());
        if !is_audio_file_extension(extension.as_deref()) {
            ReadSongMetadataError::NotAnAudioFile {
                path: path.clone(),
                extension,
            }
        } else {
            match error.kind() {
                lofty::error::ErrorKind::UnsupportedTag
                | lofty::error::ErrorKind::UnknownFormat => {
                    ReadSongMetadataError::UnsupportedFormat {
                        path: path.clone(),
                        extension,
                    }
                }
                _ => ReadSongMetadataError::MetadataParseFailed {
                    path: path.clone(),
                    message: error.to_string(),
                },
            }
        }
    })?;
    let file_name = file_path
        .file_name()
        .ok_or_else(|| ReadSongMetadataError::FileNameMissing { path: path.clone() })?
        .to_string_lossy()
        .into_owned();

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
                FileType::Flac | FileType::Wav | FileType::Vorbis => Some("Vorbis".to_string()),
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
        let mut bpm_from_integer = false;
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
                if allow_overwrite || (!has_primary_tag && catalog_number.is_none()) {
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
            ItemKey::Bpm => {
                if allow_overwrite || (!has_primary_tag && bpm.is_none()) {
                    if let Some(value) = item.value().text().and_then(parse_bpm_value) {
                        bpm = Some(value);
                        bpm_from_integer = false;
                    }
                }
            }
            ItemKey::IntegerBpm => {
                // Prefer the fractional field even if the integer item comes later.
                if bpm.is_none() && (allow_overwrite || !has_primary_tag) {
                    bpm = item.value().text().and_then(parse_bpm_value);
                    bpm_from_integer = bpm.is_some();
                }
            }
            item_key => {
                // Special frames such as MusicBrainz UFID have no ordinary key mapping.
                // Only custom names map with allow_unknown=true but not false.
                if item_key.map_key(tag.tag_type(), false).is_some()
                    || item_key.map_key(tag.tag_type(), true).is_none()
                {
                    extra_metadata_tags.push((
                        format!("{item_key:?}"),
                        item.value().to_owned().into_string().unwrap_or_default(),
                    ));
                }
            }
        });
        for (field_name, value) in
            custom_tags::read(tag).map_err(|error| ReadSongMetadataError::MetadataParseFailed {
                path: path.clone(),
                message: error.to_string(),
            })?
        {
            // Only Apple's namespace carries the conventional MP4 aliases.
            let alias = field_name
                .strip_prefix("----:com.apple.iTunes:")
                .unwrap_or(&field_name);
            match LegacyField::from_name(alias) {
                Some(LegacyField::Energy) => {
                    if energy.is_none() {
                        energy = Some(value);
                    }
                }
                Some(LegacyField::Bpm) => {
                    if bpm.is_none() || bpm_from_integer {
                        if let Some(value) = parse_bpm_value(&value) {
                            bpm = Some(value);
                            bpm_from_integer = false;
                        }
                    }
                }
                Some(LegacyField::MusicalKey) => {
                    if key.is_none() {
                        key = Some(value);
                    }
                }
                Some(LegacyField::Comment) => {
                    if comment.is_none() {
                        comment = Some(value);
                    }
                }
                Some(LegacyField::CatalogNumber) => {
                    if catalog_number.is_none() {
                        catalog_number = Some(value);
                    }
                }
                Some(LegacyField::Lyrics) => {
                    if lyrics.is_none() {
                        lyrics = Some(value);
                    }
                }
                None => {
                    extra_metadata_tags.push((format!("Custom: {field_name}"), value));
                }
            }
        }
        Ok::<(), ReadSongMetadataError>(())
    };

    if let Some(primary_tag) = primary_tag {
        apply_tag(primary_tag, true)?;
    }

    for tag in tagged_file.tags() {
        if primary_tag.is_some_and(|primary_tag| std::ptr::eq(primary_tag, tag)) {
            continue;
        }

        apply_tag(tag, false)?;
    }

    let cover_path = tagged_file
        .primary_tag()
        .and_then(|tag| {
            tag.pictures().first().and_then(|cover| {
                let file_ext: Option<&str> = cover.mime_type().and_then(|mime| {
                    ImageFormat::from_lofty_mimetype(mime.clone()).map(|format| format.extension())
                });
                if file_ext.is_none() {
                    eprintln!(
                        "Unsupported or missing MIME type for cover art: {:?}",
                        cover.mime_type()
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
                        eprintln!("Failed to write cover art: {:?}", err);
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

    Ok(SongMetadata {
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
    })
}

#[cfg(test)]
mod tests {
    use super::{
        apply_energy_update, apply_item_key_update_with_alias_removal, hex_digest,
        is_audio_file_extension, is_supported_audio_file_extension, read_song_metadata_v2,
        FileInfo, ReadSongMetadataError, SongMetadata, SongMetadataUpdateable,
    };
    use crate::custom_tags::LegacyField;
    use lofty::{
        id3::v2::Id3v2Tag,
        tag::{ItemKey, Tag},
    };

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
    fn read_song_metadata_reports_missing_file() {
        let path = std::env::temp_dir().join(format!("missing-{}.flac", std::process::id()));
        let cache_dir = std::env::temp_dir().join(format!("cache-{}", std::process::id()));

        let error = read_song_metadata_v2(&path, cache_dir.to_string_lossy().into_owned())
            .expect_err("missing file should return an error");

        assert_eq!(
            error,
            ReadSongMetadataError::FileNotFound {
                path: path.to_string_lossy().into_owned()
            }
        );
    }

    #[test]
    fn read_song_metadata_reports_not_audio_file() {
        let root = std::env::temp_dir().join(format!("not-audio-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let path = root.join("notes.txt");
        std::fs::write(&path, b"not audio").expect("write text file");

        let error = read_song_metadata_v2(&path, root.to_string_lossy().into_owned())
            .expect_err("text file should return an error");

        assert_eq!(
            error,
            ReadSongMetadataError::NotAnAudioFile {
                path: path.to_string_lossy().into_owned(),
                extension: Some("txt".to_string())
            }
        );

        std::fs::remove_dir_all(root).expect("remove temp dir");
    }

    #[test]
    fn read_song_metadata_reports_unsupported_audio_format() {
        let root = std::env::temp_dir().join(format!("unsupported-audio-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let path = root.join("song.wma");
        std::fs::write(&path, b"not a valid wma, but wma is an audio extension")
            .expect("write unsupported audio file");

        let error = read_song_metadata_v2(&path, root.to_string_lossy().into_owned())
            .expect_err("unsupported audio file should return an error");

        assert_eq!(
            error,
            ReadSongMetadataError::UnsupportedFormat {
                path: path.to_string_lossy().into_owned(),
                extension: Some("wma".to_string())
            }
        );

        std::fs::remove_dir_all(root).expect("remove temp dir");
    }

    #[test]
    fn recognizes_lofty_supported_audio_extensions() {
        for extension in [
            "3gp", "aac", "afc", "aif", "aifc", "aiff", "ape", "flac", "m4a", "m4b", "m4p", "m4r",
            "m4v", "mp+", "mp1", "mp2", "mp3", "mp4", "mpc", "mpp", "ogg", "opus", "spx", "wav",
            "wave", "wv",
        ] {
            assert!(
                is_supported_audio_file_extension(Some(extension)),
                "{extension} should be recognized"
            );
        }

        assert!(is_supported_audio_file_extension(Some("FLAC")));
        assert!(!is_supported_audio_file_extension(Some("wma")));
        assert!(!is_supported_audio_file_extension(Some("txt")));
        assert!(!is_supported_audio_file_extension(None));
    }

    #[test]
    fn recognizes_known_audio_extensions_for_error_classification() {
        for extension in ["flac", "wma", "mka", "ra", "mid", "tta", "voc", "oga"] {
            assert!(
                is_audio_file_extension(Some(extension)),
                "{extension} should be recognized as an audio extension"
            );
        }

        assert!(is_audio_file_extension(Some("WMA")));
        assert!(!is_audio_file_extension(Some("txt")));
        assert!(!is_audio_file_extension(None));
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
        let mut native = Id3v2Tag::new();
        native.insert_user_text("COMMENT".into(), "legacy comment".into());
        native.insert_user_text("LYRICS".into(), "legacy lyrics".into());
        let mut tag: Tag = native.into();

        assert!(apply_item_key_update_with_alias_removal(
            &mut tag,
            ItemKey::Comment,
            LegacyField::Comment,
            Some(Some("fresh comment".to_string())),
        )
        .unwrap());
        assert!(apply_item_key_update_with_alias_removal(
            &mut tag,
            ItemKey::Lyrics,
            LegacyField::Lyrics,
            Some(None),
        )
        .unwrap());

        assert_eq!(tag.get_string(&ItemKey::Comment), Some("fresh comment"));
        assert_eq!(tag.get_string(&ItemKey::Lyrics), None);
        let native = Id3v2Tag::from(tag);
        assert_eq!(native.get_user_text("COMMENT"), None);
        assert_eq!(native.get_user_text("LYRICS"), None);
    }

    #[test]
    fn energy_update_replaces_legacy_aliases() {
        let mut native = Id3v2Tag::new();
        native.insert_user_text("EnergyLevel".into(), "3".into());
        native.insert_user_text("ENERGYLEVEL".into(), "5".into());
        let mut tag: Tag = native.into();
        assert!(apply_energy_update(&mut tag, Some(Some("8".into()))).unwrap());
        let native = Id3v2Tag::from(tag);
        assert_eq!(native.get_user_text("ENERGY"), Some("8"));
        assert_eq!(native.get_user_text("EnergyLevel"), None);
        assert_eq!(native.get_user_text("ENERGYLEVEL"), None);
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
