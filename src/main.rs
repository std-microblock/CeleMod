extern crate sciter;

fn main() {
    sciter::set_options(sciter::RuntimeOptions::DebugMode(true)).unwrap();
    sciter::set_options(sciter::RuntimeOptions::ScriptFeatures(
        sciter::SCRIPT_RUNTIME_FEATURES::ALLOW_SOCKET_IO as u8,
    )).unwrap();
    let mut frame = sciter::Window::new();
    
    frame.set_options(sciter::window::Options::DebugMode(true)).unwrap();
    frame.set_options(sciter::window::Options::MainWindow(true)).unwrap();
    frame.set_options(sciter::window::Options::TransparentWindow(true)).unwrap();

    #[cfg(debug_assertions)]
    frame.load_html(include_bytes!("./ui/debug_index.html"), Some("app://index.html"));

    frame.run_app();
}