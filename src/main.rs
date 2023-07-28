extern crate sciter;

fn main() {
    sciter::set_options(sciter::RuntimeOptions::DebugMode(true)).unwrap();
    sciter::set_options(sciter::RuntimeOptions::ScriptFeatures(
        sciter::SCRIPT_RUNTIME_FEATURES::ALLOW_SOCKET_IO as u8,
    )).unwrap();
    let mut frame = sciter::WindowBuilder::main()
        .with_size((400, 600))
        .debug()
        .glassy()
        .alpha()
        .closeable()
        .create();
    // frame.set_options(sciter::window::Options::TransparentWindow(true)).unwrap();
    // frame.set_options(sciter::window::Options::AlphaWindow(true)).unwrap();


    #[cfg(debug_assertions)]
    frame.load_html(include_bytes!("./celemod-ui/debug_index.html"), Some("app://index.html"));

    frame.run_app();
}