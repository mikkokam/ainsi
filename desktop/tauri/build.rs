use std::path::PathBuf;

/*
 * The checkout this shell runs and the bun that runs it are baked in here.
 *
 * A dev-only shell has exactly one ainsi to start, and an app launched from Finder gets the
 * login environment, which on a mac has no homebrew in it: a bare `bun` in the spawn would
 * resolve to nothing.
 */
fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo = manifest.parent().unwrap().parent().unwrap();
    println!("cargo:rustc-env=AINSI_REPO={}", repo.display());

    let bun = which::which("bun").expect("no bun on PATH to build against");
    println!("cargo:rustc-env=AINSI_BUN={}", bun.display());

    tauri_build::build();
}
