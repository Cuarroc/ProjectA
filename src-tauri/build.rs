fn main() {
    // The embedded identifier (build_identifier.rs) is read through
    // option_env!; without this line a local rebuild after an env change
    // would silently keep the previous build's identifier.
    println!("cargo:rerun-if-env-changed=PROJECTA_IDENTIFIER");
    tauri_build::build();
}
