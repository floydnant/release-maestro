pub fn separator() -> char {
    if cfg!(windows) {
        '\\'
    } else {
        '/'
    }
}
