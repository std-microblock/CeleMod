use std::process::Command;

fn main(){
    Command::new("./sciter/packfolder.exe")
        .arg("./src/celemod-ui/dist")
        .arg("./resources/dist.rc")
        .arg("-binary")
        .spawn()
        .unwrap();
}