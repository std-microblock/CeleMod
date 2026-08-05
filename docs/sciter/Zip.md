# class Zip

The Zip class allows to access content of zip files and blobs.

Zip Archive can be mounted at particular URL:

```JavaScript
const rs = await fetch("remote url");
const archive = Zip.openData(rs.arrayBuffer());

archive.mountTo("this://mounts/test/"); 
```

After that data from the archive can be accessed as any other resource:

```HTML
<img src="this://mounts/test/images/foo.png">
```

```JS
import {Bar} from "this://mounts/test/bar.js";
```

and so on.

## Static methods

### `Zip.openFile(path:string [,password]): Zip`

Opens zip file for reading. Returns instance of Zip class.

### `Zip.open(data:ArrayBuffer[,password]): Zip`

Opens zip blob for reading. Returns instance of Zip class.

### ~~`Zip.create(provider[,password]): ArrayBuffer`~~

~~Creates zipped blob from items supplied by _provider_ function. _provider_ has the following signature:~~

~~`function(n) : [localPath:string, itemData: ArrayBuffer [,fileAttributes:int] | null`~~

## Properties:

* `zip.length` - reports total number of items in the zip;

## Methods:

### `zip.item(index:int) ZipItem`

Fetches zip item by index. Index must be in range [0 .. zip.length).

### `zip.item(path:string) ZipItem`

Fetches zip item by its path (local to the zip).

## (iterator)

The Zip supports iterator to walk over content of the zip:

```JS
  const zip = Zip.openFile(...);
  for(const item of zip) 
     console.log(item.path);
```

# class ZipItem

ZipItem is a structure that represents single entry inside the zip.

## Properties:

* `item.isDir:bool` - _true_ if the item represents directory inside the zip;
* `item.isFile:bool` - _true_ if the item represents file;
* `item.path:string` - local path of the item inside the zip;
* `item.data:ArrayBuffer` - data of the item as ArrayBuffer. Use [`srt.decode(arrayBuffer,"utf-8")`](module-sciter.md) to convert the data to string if needed.


