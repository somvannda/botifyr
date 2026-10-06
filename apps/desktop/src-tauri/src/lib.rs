use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::State;

/// Holds the local-node child process so we can start/stop it from the app.
struct NodeProcess(Mutex<Option<Child>>);

/// In development the repo is three levels up from src-tauri.
fn repo_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .canonicalize()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn stop(child: &mut Child) {
    let pid = child.id().to_string();
    let _ = Command::new("taskkill")
        .args(["/PID", pid.as_str(), "/T", "/F"])
        .status();
    let _ = child.kill();
}

#[tauri::command]
fn start_local_node(token: String, state: State<NodeProcess>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|error| error.to_string())?;
    if let Some(mut existing) = guard.take() {
        stop(&mut existing);
    }

    let root = repo_root();
    let child = Command::new("cmd")
        .args(["/C", "npm run node:start"])
        .current_dir(&root)
        .env("BOTIFYR_TOKEN", &token)
        .spawn()
        .map_err(|error| format!("failed to start local node: {error}"))?;

    *guard = Some(child);
    Ok(())
}

#[tauri::command]
fn stop_local_node(state: State<NodeProcess>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|error| error.to_string())?;
    if let Some(mut child) = guard.take() {
        stop(&mut child);
    }
    Ok(())
}

/// Bring the main window to the front (used when a deep link reopens the app).
fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single instance must be registered before any other plugin. When the
    // browser opens `botifyr://...` we focus the existing window instead of
    // launching a second copy.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main(app);
        }));
    }

    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(NodeProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_local_node, stop_local_node])
        .setup(|app| {
            // On Windows (dev + prod) and Linux, register the `botifyr://`
            // scheme against this executable so the web page can open the app.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(error) = app.deep_link().register_all() {
                    eprintln!("failed to register deep link scheme: {error}");
                }
            }
            let _ = app;
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running Botifyr");
}
