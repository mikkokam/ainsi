#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/*
 * The desktop shell: a native window over the studio the CLI already serves.
 *
 * Nothing about the deck is understood here. The shell asks for a file, starts the studio
 * beside it and points a webview at it, so every feature the studio grows arrives in the app
 * without a line changing on this side.
 */

const REPO: &str = env!("AINSI_REPO");
const BUN: &str = env!("AINSI_BUN");

/// the studio prints one line naming where it is; nothing else on stdout looks like this
const URL_MARK: &str = "studio on ";
const GIVE_UP: std::time::Duration = std::time::Duration::from_secs(20);

/// the running studio, held so it dies with the window rather than keeping a port forever
struct Studio(Mutex<Option<Child>>);

fn main() {
    // AINSI_DECK skips the dialog: how the shell is tested, and how a deck opens from a
    // terminal. The same door as the other shell, whose launcher swallows argv.
    let picked = match std::env::var_os("AINSI_DECK") {
        Some(given) => PathBuf::from(given),
        None => match pick() {
            Some(chosen) => chosen,
            None => return,
        },
    };
    let deck = picked.extension().is_some_and(|e| e == "md").then(|| picked.clone());
    let root = match &deck {
        Some(file) => file.parent().unwrap().to_path_buf(),
        None => picked.clone(),
    };

    let (mut child, url) = match start(deck.as_deref(), &root) {
        Ok(started) => started,
        Err(why) => {
            rfd::MessageDialog::new()
                .set_title("ainsi")
                .set_description(&why)
                .set_level(rfd::MessageLevel::Error)
                .show();
            return;
        }
    };

    let title = deck
        .as_ref()
        .and_then(|d| d.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ainsi".into());

    let built = tauri::Builder::default()
        .setup(move |app| {
            let window = WebviewWindowBuilder::new(app, "studio", WebviewUrl::External(url.parse()?))
                .title(&title)
                .inner_size(1440.0, 900.0);
            #[cfg(target_os = "macos")]
            let window = window.title_bar_style(tauri::TitleBarStyle::Overlay);
            window.build()?;
            Ok(())
        })
        .build(tauri::generate_context!());

    match built {
        Ok(app) => {
            app.manage(Studio(Mutex::new(Some(child))));
            app.run(|handle, event| {
                if let tauri::RunEvent::Exit = event {
                    if let Some(mut running) = handle.state::<Studio>().0.lock().unwrap().take() {
                        let _ = running.kill();
                    }
                }
            });
        }
        Err(why) => {
            // the studio is already up at this point and would outlive a failed window
            let _ = child.kill();
            eprintln!("{why}");
        }
    }
}

/// A markdown file opens straight into it; a folder opens the studio's own chooser under it,
/// which is where New deck lives.
fn pick() -> Option<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
    rfd::FileDialog::new()
        .set_title("Open a deck")
        .set_directory(&home)
        .add_filter("markdown", &["md"])
        .pick_file()
        .or_else(|| rfd::FileDialog::new().set_directory(&home).pick_folder())
}

/*
 * Start `ainsi` as a child process and wait for the URL it prints.
 *
 * The port is left to the OS (`--port 0`) and read back off stdout rather than chosen here:
 * picking a free port and then handing it over loses the race against anything else on the
 * machine between the two steps.
 */
fn start(deck: Option<&Path>, root: &Path) -> Result<(Child, String), String> {
    let cli = format!("{REPO}/src/cli.ts");
    let mut command = Command::new(BUN);
    command.arg(&cli);
    if let Some(file) = deck {
        command.arg(file);
    }
    command
        .args(["--port", "0"])
        .current_dir(root)
        // the studio refuses to start without a terminal, so an agent piping it gets a file
        // rather than a server it cannot see. This says who is asking.
        .env("AINSI_HOST", "tauri")
        // the studio watches this pipe and stops when it closes, so a shell that dies without
        // running its exit handler does not leave a server nobody can reach
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|why| format!("could not run {BUN}: {why}"))?;

    let stdout = child.stdout.take().expect("stdout was piped");
    let (found, url) = mpsc::channel();
    // the reader outlives the wait: a studio whose stdout nobody drains blocks on a full pipe
    // the first time it rebuilds, which looks like the app hanging rather than a lost log
    std::thread::spawn(move || {
        let mut said = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            println!("{line}");
            if !said {
                if let Some(at) = line.find(URL_MARK) {
                    said = found.send(line[at + URL_MARK.len()..].trim().to_string()).is_ok();
                }
            }
        }
    });

    match url.recv_timeout(GIVE_UP) {
        Ok(where_it_is) => Ok((child, where_it_is)),
        Err(_) => {
            let _ = child.kill();
            Err(format!("no studio after {}s; run `{BUN} {cli}` to see why", GIVE_UP.as_secs()))
        }
    }
}
