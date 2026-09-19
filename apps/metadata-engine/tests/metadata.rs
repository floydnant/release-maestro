mod support;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use support::{fixtures, Engine, Library};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    file: String,
    expected: BTreeMap<MetadataField, ExpectedValue>,
    #[serde(default)]
    extras: Vec<[String; 2]>,
    #[serde(default)]
    artwork: bool,
    #[serde(default)]
    writable: bool,
    #[serde(default)]
    create_tag: bool,
    alias_field: Option<AliasField>,
}

#[derive(Deserialize, Serialize, Eq, PartialEq, Ord, PartialOrd)]
#[serde(rename_all = "camelCase")]
enum MetadataField {
    Title,
    Artist,
    AlbumTitle,
    AlbumArtist,
    Genre,
    Track,
    Comment,
    Lyrics,
    MusicalKey,
    Bpm,
    CatalogNumber,
    Label,
    Energy,
    Date,
    Year,
}

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
enum ExpectedValue {
    Text(String),
    Number(f64),
    Null,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
enum AliasField {
    Energy,
    Bpm,
    MusicalKey,
    Comment,
    CatalogNumber,
    Lyrics,
}

impl AliasField {
    fn name(self) -> &'static str {
        match self {
            Self::Energy => "energy",
            Self::Bpm => "bpm",
            Self::MusicalKey => "musicalKey",
            Self::Comment => "comment",
            Self::CatalogNumber => "catalogNumber",
            Self::Lyrics => "lyrics",
        }
    }
}

fn cases() -> Vec<Fixture> {
    serde_json::from_slice(&std::fs::read(fixtures().join("cases.json")).unwrap()).unwrap()
}

fn assert_fields(actual: &Value, expected: &Value, context: &str) {
    for (key, value) in expected.as_object().unwrap() {
        if value.is_number() && actual[key].is_number() {
            assert_eq!(actual[key].as_f64(), value.as_f64(), "{context}: {key}");
            continue;
        }
        assert_eq!(&actual[key], value, "{context}: {key}");
    }
}

fn assert_extras(actual: &Value, case: &Fixture) {
    for extra in &case.extras {
        assert!(
            actual["extraMetadata"]
                .as_array()
                .unwrap()
                .contains(&json!(extra)),
            "{} missing {extra:?}: {}",
            case.file,
            actual["extraMetadata"]
        );
    }
}

#[test]
fn fixture_manifest_rejects_unknown_fields_and_invalid_flags() {
    for source in [
        r#"{"file":"x.mp3","expected":{},"writeable":true}"#,
        r#"{"file":"x.mp3","expected":{"titel":"x"}}"#,
        r#"{"file":"x.mp3","expected":{},"writable":"yes"}"#,
        r#"{"file":"x.mp3","expected":{},"aliasField":"musicalkey"}"#,
    ] {
        assert!(serde_json::from_str::<Fixture>(source).is_err(), "{source}");
    }
}

#[test]
fn reads_independently_authored_metadata_across_formats_and_legacy_aliases() {
    let library = Library::new();
    let mut engine = Engine::new();
    for case in cases() {
        let name = case.file.as_str();
        let path = library.copy(name);
        let metadata = engine.request("read_file", library.params(&path));
        assert_fields(
            &metadata,
            &serde_json::to_value(&case.expected).unwrap(),
            name,
        );
        assert_extras(&metadata, &case);
        assert_eq!(metadata["path"], path.to_str().unwrap());
        assert_eq!(metadata["fileName"], name);
        assert!(metadata["duration"].as_f64().unwrap() > 0.0, "{name}");
        assert_eq!(metadata["fileInfo"]["channels"], 2, "{name}");
        if case.artwork {
            let cover = metadata["coverPath"].as_str().unwrap();
            assert!(std::path::Path::new(cover).starts_with(library.0.join("cache")));
            assert_eq!(
                std::fs::read(cover).unwrap(),
                std::fs::read(fixtures().join("cover.png")).unwrap()
            );
        }
    }
}

#[test]
fn edits_and_clears_tags_without_losing_unrelated_metadata_or_artwork() {
    let library = Library::new();
    let mut engine = Engine::new();
    for case in cases().into_iter().filter(|case| case.writable) {
        let name = case.file.as_str();
        let path = library.copy(name);
        let original = engine.request("read_file", library.params(&path));
        let mut params = library.params(&path);
        params["update"] = json!({"title": "Gökotta", "energy": "9", "comment": "New comment", "lyrics": "New lyrics"});
        let written = engine.request("write_tags", params.clone());
        assert_fields(&written, &params["update"], name);
        // A fresh process must see persisted tags, not an in-memory update.
        let reread = Engine::new().request("read_file", library.params(&path));
        assert_fields(&reread, &params["update"], name);
        for key in [
            "artist",
            "albumTitle",
            "albumArtist",
            "genre",
            "track",
            "bpm",
            "musicalKey",
            "catalogNumber",
            "label",
            "duration",
            "coverPath",
        ] {
            assert_eq!(reread[key], original[key], "{name}: preserved {key}");
        }
        assert_extras(&reread, &case);
        if ["mp3", "wav", "aiff"].iter().any(|ext| name.ends_with(ext)) {
            assert!(
                std::fs::read(&path)
                    .unwrap()
                    .windows(9)
                    .any(|bytes| bytes == b"\x00\x01opaque\xff"),
                "{name}: private ID3 frame preserved"
            );
        }
        params["update"] = json!({"energy": null, "comment": null, "lyrics": null});
        engine.request("write_tags", params.clone());
        let cleared = Engine::new().request("read_file", library.params(&path));
        assert_fields(&cleared, &params["update"], name);
        assert_extras(&cleared, &case);
        assert_eq!(cleared["title"], "Gökotta");
        // Omitted fields do not trigger a rewrite.
        let bytes = std::fs::read(&path).unwrap();
        params["update"] = json!({});
        engine.request("write_tags", params);
        assert_eq!(std::fs::read(&path).unwrap(), bytes, "{name}: empty update");
    }
}

#[test]
fn clearing_legacy_aliases_does_not_resurrect_old_values() {
    let library = Library::new();
    let mut engine = Engine::new();
    for case in cases()
        .into_iter()
        .filter(|case| case.alias_field.is_some())
    {
        let name = case.file.as_str();
        let path = library.copy(name);
        let field = case.alias_field.unwrap().name();
        let mut params = library.params(&path);
        let replacement = if field == "bpm" {
            json!(132.25)
        } else {
            json!("updated value")
        };
        for value in [replacement, Value::Null] {
            params["update"] = json!({field: value});
            engine.request("write_tags", params.clone());
            let metadata = Engine::new().request("read_file", library.params(&path));
            assert_eq!(metadata[field], value, "{name}: {metadata}");
        }
    }
}

#[test]
fn creates_primary_tags_on_untagged_files() {
    let library = Library::new();
    let mut engine = Engine::new();
    for case in cases().into_iter().filter(|case| case.create_tag) {
        let name = case.file.as_str();
        let path = library.copy(name);
        let mut params = library.params(&path);
        params["update"] = json!({"title": "El sueño", "energy": "8"});
        let result = engine.request("write_tags", params.clone());
        assert_fields(&result, &params["update"], name);
        assert_fields(
            &Engine::new().request("read_file", library.params(&path)),
            &params["update"],
            name,
        );
    }
}

#[test]
fn streams_successes_and_parse_errors_then_accepts_another_request() {
    let library = Library::new();
    let good = library.copy("vardae-invocacion-del-cielo.flac");
    let bad = library.0.join("truncated.flac");
    std::fs::write(&bad, b"fLaC\x80\x00\x00\x22").unwrap();
    let mut engine = Engine::new();
    let messages = engine.exchange(
        "read_files",
        json!({"paths": [good, bad], "coverArtCacheDir": library.0.join("cache")}),
    );
    assert_eq!(messages[0]["event"], "started");
    let items: Vec<_> = messages.iter().filter(|m| m["event"] == "item").collect();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["data"]["metadata"]["energy"], "7");
    let errors: Vec<_> = messages
        .iter()
        .filter(|m| m["event"] == "item_error")
        .collect();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0]["data"]["code"], "PARSE_FAILED");
    assert_eq!(
        messages.last().unwrap()["result"],
        json!({"count": 1, "total": 2})
    );
    assert_eq!(engine.request("ping", json!({}))["protocolVersion"], 1);
}

#[test]
fn falls_back_to_folder_art_and_filename_without_tags() {
    let library = Library::new();
    let path = library.copy("spunoff-el-sueno-untagged.mp3");
    let cover = library.copy("cover.png");
    let result = Engine::new().request("read_file", library.params(&path));
    assert_eq!(result["title"], "spunoff-el-sueno-untagged.mp3");
    assert_eq!(result["coverPath"], cover.to_str().unwrap());
}

#[test]
fn writes_numeric_fields_dates_and_renames_then_rejects_invalid_bpm_without_writing() {
    let library = Library::new();
    let mut engine = Engine::new();
    let path = library.copy("vardae-invocacion-del-cielo.flac");
    let mut params = library.params(&path);
    params["update"] = json!({"track": 12, "bpm": 128.125, "date": "2025-03-04", "artist": " Fréquence Polaire ", "fileName": "frequence-polaire-gokotta.flac"});
    let result = engine.request("write_tags", params);
    assert!(!path.exists());
    let renamed = library.0.join("frequence-polaire-gokotta.flac");
    assert_eq!(result["path"], renamed.to_str().unwrap());
    let reread = Engine::new().request("read_file", library.params(&renamed));
    assert_fields(
        &reread,
        &json!({"track": 12, "bpm": 128.125, "date": "2025-03-04", "artist": "Fréquence Polaire"}),
        "renamed FLAC",
    );
    let bytes = std::fs::read(&renamed).unwrap();
    let mut params = library.params(&renamed);
    params["update"] = json!({"title": "Must not persist", "bpm": -1});
    let messages = engine.exchange("write_tags", params.clone());
    assert_eq!(messages.last().unwrap()["ok"], false);
    assert_eq!(std::fs::read(&renamed).unwrap(), bytes);
    params["update"] = json!({"track": null, "bpm": null, "date": null, "artist": "   "});
    let cleared = engine.request("write_tags", params);
    assert_fields(
        &cleared,
        &json!({"track": null, "bpm": null, "date": null, "artist": null}),
        "cleared FLAC",
    );
}

#[test]
fn mp4_tempo_edits_replace_native_integer_atoms_and_clear_persistently() {
    let library = Library::new();
    let path = library.copy("vardae-invocacion-del-cielo.m4a");
    for update in [
        json!({"bpm": null}),
        json!({"bpm": 131.125}),
        json!({"bpm": null}),
    ] {
        let mut params = library.params(&path);
        params["update"] = update.clone();
        Engine::new().request("write_tags", params);
        let actual = Engine::new().request("read_file", library.params(&path));
        assert_fields(&actual, &update, "MP4 tempo");
    }
}

#[test]
fn edits_preserve_the_secondary_id3v1_tag() {
    let library = Library::new();
    let path = library.copy("id3-priority.mp3");
    let bytes = std::fs::read(&path).unwrap();
    let footer = &bytes[bytes.len() - 128..];
    assert_eq!(&footer[..3], b"TAG");
    for update in [
        json!({"title": "Invocación Del Cielo"}),
        json!({"comment": null}),
    ] {
        let mut params = library.params(&path);
        params["update"] = update.clone();
        Engine::new().request("write_tags", params);
        let actual = Engine::new().request("read_file", library.params(&path));
        assert_fields(&actual, &update, "ID3v2 edit");
        let edited = std::fs::read(&path).unwrap();
        assert_eq!(&edited[edited.len() - 128..], footer);
    }
}

#[test]
fn fractional_id3_tempo_keeps_the_standard_integer_frame() {
    use lofty::{file::TaggedFileExt, tag::ItemKey};
    let library = Library::new();
    for name in [
        "vardae-invocacion-del-cielo.mp3",
        "vardae-invocacion-del-cielo.wav",
        "vardae-invocacion-del-cielo.aiff",
    ] {
        let path = library.copy(name);
        let mut params = library.params(&path);
        params["update"] = json!({"bpm": 132.25});
        Engine::new().request("write_tags", params);
        let actual = Engine::new().request("read_file", library.params(&path));
        assert_eq!(actual["bpm"], 132.25, "{name}");
        let native = lofty::read_from_path(&path).unwrap();
        assert_eq!(
            native
                .primary_tag()
                .unwrap()
                .get_string(&ItemKey::IntegerBpm),
            Some("132"),
            "{name}: standard TBPM"
        );
    }
}

#[test]
fn unrelated_mp4_edits_preserve_every_value_in_mixed_native_atoms() {
    use lofty::{
        config::ParseOptions,
        file::AudioFile,
        mp4::{AtomIdent, Mp4File},
    };
    fn read(path: &std::path::Path) -> Mp4File {
        Mp4File::read_from(&mut std::fs::File::open(path).unwrap(), ParseOptions::new()).unwrap()
    }
    let library = Library::new();
    let path = library.copy("mixed-data.m4a");
    let original = read(&path);
    let atoms: Vec<_> = original
        .ilst()
        .unwrap()
        .into_iter()
        .filter(|atom| {
            matches!(atom.ident(), AtomIdent::Freeform { mean, .. } if mean == "org.example")
                || atom.ident() == &AtomIdent::Fourcc(*b"covr")
        })
        .collect();
    assert_eq!(atoms.len(), 7);
    for atom in &atoms {
        assert_eq!(atom.data().count(), 2);
    }
    for update in [
        json!({"title": "Gökotta"}),
        json!({"energy": "8"}),
        json!({"comment": null}),
        json!({"bpm": null}),
    ] {
        let mut params = library.params(&path);
        params["update"] = update.clone();
        Engine::new().request("write_tags", params);
        let edited = read(&path);
        for atom in &atoms {
            let actual: Vec<_> = edited
                .ilst()
                .unwrap()
                .into_iter()
                .filter(|candidate| candidate.ident() == atom.ident())
                .flat_map(|atom| atom.data())
                .collect();
            let expected: Vec<_> = atom.data().collect();
            assert!(
                actual == expected,
                "{:?} lost native MP4 data during {update}",
                atom.ident()
            );
        }
    }
}

#[test]
fn clearing_riff_aliases_does_not_resurrect_secondary_values() {
    let library = Library::new();
    for field in ["bpm", "musicalKey"] {
        let path = library.copy("riff-aliases.wav");
        let mut params = library.params(&path);
        let replacement = if field == "bpm" {
            json!(130.5)
        } else {
            json!("Bm")
        };
        for value in [Value::Null, replacement, Value::Null] {
            params["update"] = json!({field: value, "title": "Gökotta", "artist": "SpunOff"});
            Engine::new().request("write_tags", params.clone());
            let actual = Engine::new().request("read_file", library.params(&path));
            assert_eq!(actual[field], value, "{field}: {actual}");
            assert_eq!(actual["title"], "Gökotta");
            assert_eq!(actual["artist"], "SpunOff");
            assert!(actual["extraMetadata"]
                .as_array()
                .unwrap()
                .contains(&json!(["Custom: XTRA", "keep me"])));
        }
    }
}

#[test]
fn editing_mp4_text_retains_opaque_values_but_clearing_removes_the_atom() {
    use lofty::{
        config::ParseOptions,
        file::AudioFile,
        mp4::{AtomData, AtomIdent, Mp4File},
    };
    let library = Library::new();
    for (fixture, count) in [
        ("editable-mixed.m4a", 2),
        ("editable-alias.m4a", 2),
        ("editable-aliases.m4a", 4),
    ] {
        let path = library.copy(fixture);
        let mut title_edit = library.params(&path);
        title_edit["update"] = json!({"title": "Gökotta"});
        Engine::new().request("write_tags", title_edit);
        let before = Mp4File::read_from(
            &mut std::fs::File::open(&path).unwrap(),
            ParseOptions::new(),
        )
        .unwrap();
        assert_eq!(
            before
                .ilst()
                .unwrap()
                .into_iter()
                .flat_map(|atom| atom.data())
                .filter(
                    |data| matches!(data, AtomData::Unknown { data, .. } if data == b"keep-energy")
                )
                .count(),
            count
        );
        let ident = AtomIdent::Freeform {
            mean: "com.apple.iTunes".into(),
            name: "ENERGY".into(),
        };
        for value in [json!("7"), json!("8"), json!("9"), Value::Null] {
            let mut params = library.params(&path);
            params["update"] = json!({"energy": value});
            Engine::new().request("write_tags", params);
            let actual = Engine::new().request("read_file", library.params(&path));
            assert_eq!(actual["energy"], value);
            let native = Mp4File::read_from(
                &mut std::fs::File::open(&path).unwrap(),
                ParseOptions::new(),
            )
            .unwrap();
            let atoms: Vec<_> = native
                .ilst()
                .unwrap()
                .into_iter()
                .filter(|atom| atom.ident() == &ident)
                .collect();
            if value.is_null() {
                assert!(atoms.is_empty());
            } else {
                let opaque = atoms
                .iter()
                .flat_map(|atom| atom.data())
                .filter(
                    |data| matches!(data, AtomData::Unknown { data, .. } if data == b"keep-energy"),
                )
                .count();
                assert_eq!(opaque, count, "editing ENERGY preserves every opaque entry");
            }
        }
    }
}
