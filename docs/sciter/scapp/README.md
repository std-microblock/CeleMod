# Scapp Executable Runtime

scapp[.exe] is Sciter engine packaged as a standlone executable. 

While it uses the same Sciter engine as embeddable sciter.dll(.so,.dylib) it has some differences.

One of major differences is that scapp supports "assembly" mode: UI resources (html,css,js and image files) can be packaged and appended to the scapp.exe. This allows to generate (assemble) standalone executables - monolithitic executables without external dependencies. Such assembly support enables [Sciter.Quark](https://quark.sciter.com/) functionality.

## Scapp startup sequences:


### Original scapp.exe

Original scapp.exe can be started as with as without parameters:

```
> scapp.exe [filename] [--debug]
```

If **filename** is given then it shall be either `.htm` or `.html` to run that file in _html window mode_.
If the file has `.js` extension then it gets run in [_bootstrap mode_](bootstrap-runtime-mode.md).

If **no filename** is provided then the runtime looks for the following files in the same folder where scapp.exe is located.

1. `run.js` - this file is used to run application in bootstrap mode;
2. `scapp.htm[l]` 
3. `main.htm[l]`
4. `index.htm[l]` - first matching file will be used to create HTML window.


### Assembled _yourname_.exe

Executables that are assembled from scapp.exe by the Quark use attached resource package to run.

Scapp runtime looks for the following files at root of the packaged folder: 

1. `/run.js` - [_bootstrap mode_](bootstrap-runtime-mode.md) execution;
2. `/index.htm` - HTML window execution;
3. `/main.htm` - HTML window execution.

First found file (in that order) is used to run the application. 

Url of the startup file is set to be "this://app/" + file.ext

If neither of these files are found in the attached package the runtime performs original steps as above.
