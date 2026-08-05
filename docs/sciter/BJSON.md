# class BJSON

BJSON provides packaging and unpackaging of JSON in binary form.

## constructor:

* `let bjson = new BJSON()` - creates binary JSON pack/unpack context.

## methods:

* ### `bjson.pack(data) : ArrayBuffer`

  Serializes _data_ to the ArrayBuffer.

* ### `bjson.unpack(blob: ArrayBuffer, receiver:function(data))`

  Restores _data_ from BJSON _blob_. 

#### example:

This code packages and restores `{hello:"world"}` object:

```JavaScript
let bjson = new BJSON();
// packaging:
let blob = bjson.pack({hello:"world"});
// unpackaging:
bjson.unpack(blob, data => {
  console.assert(data.hello =="world");
});
```