use std::path::Path;

pub enum ImageFormat {
    Jpeg,
    Png,
    Bmp,
    Gif,
    Tiff,
    Webp,
    Svg,
}
impl ImageFormat {
    pub fn extension(&self) -> &'static str {
        match self {
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Png => "png",
            ImageFormat::Bmp => "bmp",
            ImageFormat::Gif => "gif",
            ImageFormat::Tiff => "tiff",
            ImageFormat::Webp => "webp",
            ImageFormat::Svg => "svg",
        }
    }

    pub fn from_lofty_mimetype(mime_type: lofty::picture::MimeType) -> Option<ImageFormat> {
        return match mime_type {
            lofty::picture::MimeType::Jpeg => Some(ImageFormat::Jpeg),
            lofty::picture::MimeType::Png => Some(ImageFormat::Png),
            lofty::picture::MimeType::Bmp => Some(ImageFormat::Bmp),
            lofty::picture::MimeType::Gif => Some(ImageFormat::Gif),
            lofty::picture::MimeType::Tiff => Some(ImageFormat::Tiff),
            _ => None,
        }
    }

    pub fn from_file_name(file_name: &str) -> Option<ImageFormat> {
        if let Some(ext) = Path::new(file_name)
            .extension()
            .and_then(|ext| ext.to_str())
        {
            return match ext {
                "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
                "png" => Some(ImageFormat::Png),
                "bmp" => Some(ImageFormat::Bmp),
                "gif" => Some(ImageFormat::Gif),
                "tiff" => Some(ImageFormat::Tiff),
                "webp" => Some(ImageFormat::Webp),
                "svg" => Some(ImageFormat::Svg),
                _ => None,
            };
        }
        None
    }
}
