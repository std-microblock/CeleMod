# Bootstrap execution mode

The bootstrap execution mode is in effect when you start scapp[.exe] with .js file provided (usually it is run.js).

Main purpose of bootstrap JS code is to configure and run some preparation code before any window is created.

Here is content of typical run.js code:

```JavaScript

import * as env from "@env";
import * as sys from "@sys";

let startup;
let gfx = "gpu"; // use best GPU backend...

switch(env.PLATFORM) {
  case "Windows": 
    startup = "main-win.js"; 
    break;
  case "OSX": 
    startup = "main-mac.js"; 
    gfx = "opengl"; // force using OpenGL instead of Metal
    break;
  default: 
    startup = "main-linux.js"; 
    break;
}

application.start(gfx); // configure graphics backend

const mainWindow = new Window({
  url:__DIR__ + "hello.htm",
  parameters: {}  // parameters to pass
});
mainWindow.on("close",() => application.quit(0));

//... other initialization ...
let quitVal = application.run(); // message pump loop
//... shutdown ...
```

Here we see graphics backend configuration and main message pump loop.

## Bootstrap mode runtime

Bootstrap phase runs with special reduced environment : 

* All DOM related functions are not available - no Document, Element and other related classes and objects;
* No _fetch()_ API;
* No setTimeout and no setInterval;
* No _post()_ API;

But modules @env, @sys and @sciter are there, so bootstrap JS can read files, create TCP sockets, etc.

The only additional bootstrap specific namespace is _application_ with the following functions: 

* `application.start(gfx)`
  Selects graphics layer to be used. _gfx_ is one of:
  * "raster" - software rasterization backend;
  * "direct2d-warp" - Windows only; [Direct2d WARP](https://en.wikipedia.org/wiki/Windows_Advanced_Rasterization_Platform) backend;
  * "direct2d" - Windows only; Direct2D GPU backend - default on Windows;
  * "opengl" - all platforms; Skia/OpenGL backend; 
  * "vulkan" - Windows, Linux; Skia/Vulkan backend; 
  * "metal" - MacOS only; Skia/Metal backend; 
  * "gpu" - default value; uses best (fastest) backend available. On some [old] systems, modern backends (Metal,Vulkan) may work unreliable so you may choose other backends like "opengl".
* `application.run():int`
  This function will start so called message pump loop of UI application. The function will return only when `application.quit()` is issued; 
* `application.quit(retval: int)`
  Request to exit from `application.run()` loop. The run() function will return that _retval_ value.
