# DOM and Runtime implementation status

## global methods

* `console.log(...)`
* `console.warn(...)`
* `console.error(...)`

* ### `setTimeout(func,milliseconds)`

* ### `clearTimeout(tid)`

* ### `setInterval(func,milliseconds)`

* ### `clearInterval(iid)`

* ### `requestAnimationFrame(func): aid`

* ### `cancelAnimationFrame(aid)`

* ### `fetch(url:string | Request [, options:object]): Response` - see [Fetch](Fetch.md)

* ### `getComputedStyle(element[, pseudoEl]): Style`

* ### `printf(format:string, ...):string`
  
  The function does formatting of arguments using C-style [printf conventions](https://en.cppreference.com/w/cpp/io/c/fprintf).
  
  Returns formatted string.

  In Sciter list of standard formatting types is extended by these two: 

  * `%v` - takes argument and prints it as `JSON.stringify(arg)`;
  * `%V` - takes argument and prints it as `JSON.stringify(arg, null, "  ")`;

* ### `scanf(format:string, input: string) : [...]`

  Takes *input* string and parses it according the *format* specification using C-style [scanf conventions](https://en.cppreference.com/w/c/io/fscanf). Returns list (array) of successfully parsed values. 

* ### `evalModule(text:string [,url:string]):object`
  
  "module" version of stock `eval()` function - evaluates the text as a module body.
  
  If the _url_ is provided it is used as a base URL for resolving relative paths in `import ... from "relpath"` statements inside.

  The function returns module's exported data as an object.

* ### `loadScript(url:string)`

  Loads and executes JavaScript at url synchronously.

* ### `loadScriptModule(url:string): object`

  Loads and executes JavaScript module at url synchronously. Returns modules exports object.

## JSON

* ### `JSON.parse(text, [reviver:function]): JSON` Parses a JSON string, constructing the value or object described by the string. An optional reviver function can be provided to perform a transformation on the resulting object before it is returned.

* #### `JSON.stringify(object, [replacer:function], [indent:string])` Converts a JavaScript object or value to a JSON string, optionally replacing values if a replacer function is specified or optionally including only the specified properties if a replacer array is specified.

# class BJSON

[BJSON](BJSON.md) provides packaging and unpackaging of JSON in binary form.

# class Zip

[Zip](Zip.md) allows to read and write (TBD) zip files.

## global properties

* ### `globalThis` - object, global namespace, aliased as `window` for compatibility with browsers.

* ### `devicePixelRatio` - float, number of physical screen pixels in logical CSS px (dip).

## Standard DOM objects

* [Document](Document.md)
* [Element](Element.md)
* [Node](Node.md): [Text](Node.md#Text) and [Comment](Node.md#Comment)
* [Event](Event.md)
* [Graphics](graphics/README.md) 2D graphics and associated classes.

## Sciter specific objects

* [Window](Window.md) - desktop window defined by HTML loaded in it. 
* [Audio](Audio.md) - audio playback. 
* [Binary JSON](BJSON.md) - binary JSON.
* [Geometry](geometry/README.md) - 2D geometry helper classes.

## Sciter specific modules

* [@sciter](module-sciter.md) - Sciter's general methods.
* [@sys](module-sys.md) - System, File system and communication primitives (close to Node.JS runtime).
* [@env](module-env.md) - Running environment primitives.
* [@storage](storage/README.md) - Persistent storage - NoSQL DB built into JS runtime.
* [@debug](module-debug.md)
