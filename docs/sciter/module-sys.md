# module `@sys`

This module contains runtime methods modelled after NodeJS primitives.

To get reference to sys module use:

```JavaScript
import * as sys from "@sys"; // '@' is mandatory
```

All methods in the sys module follow NodeJS calling convention with the only exception - callbacks are not used - functions return promises instead so use them in async functions, like:

```JavaScript
const p = new sys.Pipe();

async function connect() {
  await p.connect('fooapp');
  console.log(`Connected to ${p.getpeername()}`);   
  ...
}
```

sys is built on top of [libuv](https://github.com/libuv/libuv) that Sciter.JS uses internally and QuickJS/libuv wrappers from [txiki project](https://github.com/saghul/txiki.js/). 

## `sys.fs` namespace - file system.

### functions

* #### `fs.open(path:string, flags:string [, mode:integer]): Promise(File)`

  Opens file at path.

  _flags_ <string> :

  * 'a': Open file for appending. The file is created if it does not exist.
  * 'ax': Like 'a' but fails if the path exists.
  * 'a+': Open file for reading and appending. The file is created if it does not exist.
  * 'ax+': Like 'a+' but fails if the path exists.
  * 'as': Open file for appending in synchronous mode. The file is created if it does not exist.
  * 'as+': Open file for reading and appending in synchronous mode. The file is created if it does not exist.
  * 'r': **default value**, Open file for reading. An exception occurs if the file does not exist.
  * 'r+': Open file for reading and writing. An exception occurs if the file does not exist.
  * 'rs+': Open file for reading and writing in synchronous mode. Instructs the operating system to bypass the local file system cache.

    This is primarily useful for opening files on NFS mounts as it allows skipping the potentially stale local cache. It has a very real impact on I/O performance so using this flag is not recommended unless it is needed.

    This doesn't turn fs.open() or fsPromises.open() into a synchronous blocking call. If synchronous operation is desired, something like fs.$open() should be used.

  * 'w': Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
  * 'wx': Like 'w' but fails if the path exists.
  * 'w+': Open file for reading and writing. The file is created (if it does not exist) or truncated (if it exists).
  * 'wx+': Like 'w+' but fails if the path exists.

  _mode_ Sets the file mode (permission and sticky bits) if the file is created. Default: 0o666 (readable and writable)

  Returns: _Promise_ that will be fulfilled with a _fs.File_ object.

  Refer to the POSIX open() documentation for more detail.

  Some characters (`< > : " / \ | ? *`) are reserved under Windows as documented by Naming Files, Paths, and Namespaces. Under NTFS, if the filename contains a colon, Node.js will open a file system stream, as described by this MSDN page.

* #### `fs.sync.open(path:string, flags:string [, mode:integer]): File`
* #### `fs.openSync(path:string, flags:string [, mode:integer]): File`

  Synchronous version of `fs.open()`. Returns fs.File object, see below.  

* #### `fs.stat(path:string): Promise(stat)`

  Returns promise that resolves to the _stat_ structure (object) having these fields:

  ```C++
    int64     st_dev;      /* ID of device containing file */
    int64     st_ino;      /* inode number */
    int32     st_mode;     /* ORed type flags (see below) */
    int64     st_nlink;    /* number of hard links */
    int64     st_uid;      /* user ID of owner */
    int64     st_gid;      /* group ID of owner */
    int64     st_rdev;     /* device ID (if special file) */
    int64     st_size;     /* total size, in bytes */
    int64     st_blksize;  /* blocksize for file system I/O */
    int64     st_blocks;   /* number of 512B blocks allocated */
    float64   st_atime;    /* time of last access, seconds since 1970 */
    float64   st_mtime;    /* time of last modification, seconds since 1970 */
    float64   st_ctime;    /* time of last status change, seconds since 1970 */
    float64   st_birthtime;/* time of creation, seconds since 1970 */
  ```
  
  Type flags (of st_mode):

  * `fs.S_IFDIR` - this is the file type constant of a directory file;
  * `fs.S_IFCHR` - this is the file type constant of a character-oriented device file;
  * `fs.S_IFBLK` - this is the file type constant of a block-oriented device file;
  * `fs.S_IFREG` - this is the file type constant of a regular file;
  * `fs.S_IFLNK` - this is the file type constant of a symbolic link;
  * `fs.S_IFSOCK` - this is the file type constant of a socket;
  * `fs.S_IFIFO` - this is the file type constant of a FIFO or pipe;

  Throws an `Error` exception if the file/dir does not exist.

  Additionally _stat_ structure may have one of these:

  * `isFile`, true is that is a file
  * `isDirectory`, true is that is a directory
  * `isSymbolicLink`, true is that is a link

* #### `fs.sync.stat(path:string): stat`
* #### `fs.statSync(path:string): stat`
* 
*  Sync version of the above;

  Synchronous version of the above. Returns null if the file/dir does not exist.

* #### `fs.lstat(path:string): promise(stat)`

  lstat() is identical to stat(), except that if path is a symbolic link, then the link itself is stat-ed, not the file that it refers to.

  See [lstat](https://linux.die.net/man/2/lstat)

* #### `fs.sync.lstat(path:string): stat`
* #### `fs.lstatSync(path:string): stat`
  
  Sync version of the above.

* #### `fs.realpath(pathname:string):string`

  Returns the canonicalized absolute pathname. 

  `realpath()` expands all symbolic links and resolves references to `/./`, `/../` and extra `'/'` characters in the pathname string to produce a canonicalized absolute pathname.

* #### `fs.unlink(path:string) : Promise`
   
  Deletes the file.  If path refers to a symbolic link, then the link is removed without affecting the file or directory to which that link refers. If the path refers to a file path that is not a symbolic link, the file is deleted. See the POSIX unlink documentation for more detail.
  ```JS
    async function deleteFile(path) { await sys.fs.unlink(path) }
  ```
* #### `fs.sync.unlink(path:string)`
* #### `fs.unlinkSync(path:string)`

* #### `fs.rename(oldPath:string,newPath:string) : Promise`
  
  Renames the file. Note: this may move the file to different device. Equivalent to [rename](https://man7.org/linux/man-pages/man2/rename.2.html). 

* #### `fs.renameSync(oldPath:string,newPath:string)`
* #### `fs.sync.rename(oldPath:string,newPath:string)`

* #### `fs.mkdtemp(template:string) : Promise(result:string)`

  Creates unique temporary dir. The last six characters of template must be "XXXXXX". Equivalent of [mkdtemp](https://man7.org/linux/man-pages/man3/mkdtemp.3.html)

* #### `fs.mkstemp(template:string) : Promise`
  
  Creates unique temporary file. The last six characters of template must be "XXXXXX"

* #### `fs.rmdir(path) : Promise`
  
  Delete folder

* #### `fs.sync.rmdir(path)`
* #### `fs.rmdirSync(path)`
  
  Synchronous delete folder

* #### `fs.mkdir(path[, mode = 0o777]) : Promise`
  
  Creates folder.

* #### `fs.sync.mkdir(path[, mode = 0o777])`
* #### `fs.mkdirSync(path[, mode = 0o777])`
 
  Creates folder (synchronous)

* #### `fs.chmod(path, mode:int]) : Promise`
  
  Asynchronous [chmod](https://man7.org/linux/man-pages/man2/chmod.2.html).

* #### `fs.sync.chmod(path, mode:int])`
* #### `fs.chmodSync(path, mode:int])`
 
  Synchronous [chmod](https://man7.org/linux/man-pages/man2/chmod.2.html). Throws exception in case of error.

* #### `fs.copyfile(srcpath,dstpath[,flags:int]) : Promise`

  Asynchronous file copy.

  _flags_ (optional) is a combination of: 

  * `fs.UV_FS_COPYFILE_EXCL` - to return an error if the destination already exists;
  * `fs.UV_FS_COPYFILE_FICLONE` - to attempt to create a reflink, if copy-on-write is not supported, a fallback copy mechanism is used.
  * `fs.UV_FS_COPYFILE_FICLONE_FORCE` - to attempt to create a reflink, if copy-on-write is not supported, an error is returned.

* #### `fs.sync.copyfile(srcpath,dstpath[,flags:int])`
* #### `fs.copyfileSync(srcpath,dstpath[,flags:int])`

* #### `fs.readdir(path:string) : Promise(Dir)`
  
  Reads _path_ directory asynchronously. The promise resolves to Dir object - list of direntry structures:
  ```JS
  { 
    name: string,  // local file name + extension
    type: integer, // ORed flags (see below) 
  }  
  ```
  The list does not contain "." and ".." entries.

  Direntry type bit-flags:

  * `fs.UV_DIRENT_UNKNOWN`
  * `fs.UV_DIRENT_FILE` - file
  * `fs.UV_DIRENT_DIR` - directory
  * `fs.UV_DIRENT_LINK` - link
  * `fs.UV_DIRENT_FIFO` - fifo device
  * `fs.UV_DIRENT_SOCKET` - socket 
  * `fs.UV_DIRENT_CHAR` - character stream device like terminal
  * `fs.UV_DIRENT_BLOCK` - block device
  
  ```
  for await (const {name,type} of readdir("path")) {
    ...  
  }
  ```


* #### `fs.sync.readdir(path:string): filelist`
* #### `fs.readdirSync(path:string): filelist`

  Synchronous version of `fs.readdir()` returns list of direntry striuctures.
  Returns _null_ if _path_ is not a folder.  

* #### `fs.readFile(path:string) : Promise(ArrayBuffer)`
* #### `fs.readfile(path:string) : Promise(ArrayBuffer)`
  
  Read whole file asynchronously. The promise resolves to ArrayBuffer on success or fails:

  ```JS
  try {
    let data = await fs.readfile("D:/foo/bar.txt");
    let text = srt.decode(data,"utf-8");
  } catch () {
    ...
  }
  ```

* #### `fs.sync.readFile() : ArrayBuffer`
* #### `fs.sync.readfile() : ArrayBuffer`
* #### `fs.readFileSync() : ArrayBuffer`
* #### `fs.readfileSync() : ArrayBuffer`
  
  Synchronous version of the `fs.readFile(path:string)` above. Throws exception in case of error.

* [`fs.watch()`](sys.fs/watch.md)
* [`fs.splitpath()`](sys.fs/splitpath.md)

## classes

### `fs.File` class - represents file.

* `file.read([lengthToRead:int [, filePosition:int]]): Promise(Uint8Array)`
* `file.readSync([lengthToRead:int [, filePosition:int]]): Uint8Array`
* `file.write(string|***Array|ArrayBuffer[,filePosition:int]) : Promise(result:int)` 
* `file.writeSync(string|***Array|ArrayBuffer[,filePosition:int]) : int` 
* `file.close() : Promise(undefined)`
* `file.closeSync() : undefined
* `file.fileno() : int`
* `file.stat() : Promise(object)`
* `file.path : string`

### fs.Dir class - directory visitor

* `dir.close()`
* `dir.path`
* `dir.next()`
* `[async iterator]`

## Network functions

### TCP socket class

* `socket.close()`
* `socket.read():Promise(data)`
* `socket.write(data:TypedArray | ArrayBuffer):Promise`
* `socket.shutdown()`
* `socket.fileno()`
* `socket.listen([backlog:int])`
* `socket.accept():Promise(socket)`
* `socket.getsockname(): {ip:...,port:...,family:...}`
* `socket.getpeername(): {ip:...,port:...,family:...}`
* `socket.connect({ip:...,port:...})`
* `socket.bind({ip:...,port:...})`

### UDP socket class

* `socket.close()`
* `socket.recv():Promise({data,flags:int,addr:{ip:...,port:...}})`
* `socket.send(data:TypedArray | ArrayBuffer [,{ip,port}])`
* `socket.fileno()`
* `socket.getsockname(): {ip:...,port:...,family:...}`
* `socket.getpeername(): {ip:...,port:...,family:...}`
* `socket.connect({ip:...,port:...}):Promise`
* `socket.bind({ip:...,port:...})`

### Pipe - IPC mostly

* `socket.close()`
* `socket.read()`
* `socket.write(data:TypedArray | ArrayBuffer)`
* `socket.fileno()`
* `socket.listen([backlog:int])`
* `socket.accept():Promise(socket)`
* `socket.getsockname():string`
* `socket.getpeername():string`
* `socket.connect(name:string):Promise`
* `socket.bind(name:string)`

### TTY primitives

* `tty.close()`
* `tty.read()`
* `tty.write()`
* `tty.fileno()`
* `tty.setMode()`
* `tty.getWinSize()`

## `sys.spawn()` - running processes with stdin/strout/stderr redirection.

* `process.kill()`
* `process.wait()`
* `process.pid`
* `process.stdin`
* `process.stdout`
* `process.stderr`

## `sys.****` - miscellaneous functions.

* `sys.hrtime()`
* `sys.gettimeofday()`
* `sys.uname()`
* `sys.isatty()`
* `sys.environ()`
* `sys.getenv()`
* `sys.setenv()`
* `sys.unsetenv()`
* `sys.cwd()` - Get current working directory
* `sys.homedir()`
* `sys.tmpdir()`
* `sys.exepath()`
* `sys.random()`
