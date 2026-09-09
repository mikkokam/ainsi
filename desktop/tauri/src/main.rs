#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/*
 * The desktop shell: a native window over the studio the CLI already serves.
 *
 * Nothing about the deck is understood here. The shell starts the studio and points a webview
 * at it, so every feature the studio grows arrives in the app without a line changing on this
 * side. Even opening a deck is the studio's own chooser doing it; the File menu is a second
 * door for a deck that lives somewhere the chooser cannot reach.
 */

const REPO: &str = env!("AINSI_REPO");
const BUN: &str = env!("AINSI_BUN");

/// the studio prints one line naming where it is; nothing else on stdout looks like this
const URL_MARK: &str = "studio on ";
const GIVE_UP: std::time::Duration = std::time::Duration::from_secs(20);

/// the running studio, held so it dies with the window rather than keeping a port forever
struct Studio(Mutex<Option<Child>>);

fn main() {
    // AINSI_DECK skips straight to a deck: how the shell is tested, and how one opens from a
    // terminal. Otherwise the studio starts on its own chooser, rooted at home rather than at
    // the working directory, which is `/` for anything launched from an icon.
    let deck = std::env::var_os("AINSI_DECK").map(PathBuf::from);
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()));
    let root = deck.as_deref().and_then(Path::parent).unwrap_or(&home).to_path_buf();

    let (mut child, url) = match start(deck.as_deref(), &root) {
        Ok(started) => started,
        Err(why) => return complain(&why),
    };

    let built = tauri::Builder::default()
        .setup(move |app| {
            app.set_menu(menu(app.handle())?)?;
            app.on_menu_event(|app, event| {
                if event.id() == "open" {
                    open(app.clone());
                }
            });
            WebviewWindowBuilder::new(app, "studio", WebviewUrl::External(url.parse()?))
                .title("ainsi")
                .inner_size(1440.0, 900.0)
                .build()?;
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

/// The standard mac menus, which a window holding a text editor needs for copy and paste,
/// plus the one item that is ours.
fn menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = Submenu::with_items(
        app,
        "ainsi",
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(AboutMetadata::default()))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[&MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&about, &file, &edit, &window])
}

/*
 * Opening moves the root, and the root is fixed when the studio starts, so this restarts it.
 * A second server on the old root would be a second writer over the same files; a restart
 * costs about a second and there is nothing to carry across, because the studio holds no
 * document state.
 *
 * The dialog is blocking, so it runs off the main thread: the menu event arrives on the
 * thread the window is drawn from, and holding that up freezes the window behind the panel.
 */
fn open(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
        // a folder opens the chooser under it, which is where New presentation lives
        let picked = rfd::FileDialog::new()
            .set_title("Open a deck")
            .set_directory(&home)
            .add_filter("markdown", &["md"])
            .pick_file()
            .or_else(|| rfd::FileDialog::new().set_directory(&home).pick_folder());
        let Some(picked) = picked else { return };

        let deck = picked.extension().is_some_and(|e| e == "md").then(|| picked.clone());
        let root = deck.as_deref().and_then(Path::parent).unwrap_or(&picked).to_path_buf();
        match start(deck.as_deref(), &root) {
            Ok((next, url)) => {
                let Some(window) = app.get_webview_window("studio") else { return };
                if window.navigate(url.parse().expect("the studio said where it was")).is_err() {
                    return;
                }
                if let Some(mut old) = app.state::<Studio>().0.lock().unwrap().replace(next) {
                    let _ = old.kill();
                }
            }
            Err(why) => complain(&why),
        }
    });
}

fn complain(why: &str) {
    rfd::MessageDialog::new()
        .set_title("ainsi")
        .set_description(why)
        .set_level(rfd::MessageLevel::Error)
        .show();
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
