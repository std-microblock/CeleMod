# class Element.Style

Instances of Element.Style class represent list of CSS properties set on element.

To get reference to style collection use ```element.style``` property.

## Properties:

To get/set a property use either camelCase notation as: 

```JavaScript
var bgColor = element.style.backgroundColor;
```

or the "hyphen-case" form:

```JavaScript
var bgColor = element.style["background-color"];
```

## Methods:


* ### `element.style.getPropertyValue(name)`

  returns a string containing the value of a specified CSS property.

* ### `element.style.setProperty(name, value [,important])`

  sets a new value for a CSS property.

* ### `element.style.removeProperty(name)`

  removes a property value previously set by setProperty.

* ### `element.style.colorOf(name)`

  reports a value of property _name_ as an instance of [`Graphics.Color`](Graphics/Graphics.Color.md) class. Returns null if the propety is not a color.

* ### `element.style.pixelsOf(name): number`

  reports used value of property _name_ as a number of CSS pixels. Returns null if the propety is not a length.

* ### `element.style.imageOf(name):Image`

  reports used value of property _name_ as an instance of [`Graphics.Image`](Graphics/Graphics.Image.md). Returns null if the propety is not an image.

* ### `element.style.variables([{name:value,...}]):{name:value, ...}`

  if parameter is not provided reports CSS variables seen by the element, returns the set as {name:value, ...} map.

  Otherwise, if the parameter is an object (name/value map), sets CSS variables on the element.

* ### `element.style.variable(name [, value]): value`

  if _value_ parameter is not provided, returns value of CSS variable seen by the element.

  Otherwise sets CSS variable on the element.

* ### `element.style.setCursor(null | image, hotspotX, hotspotY)`

  sets/resets element's cursor by the image and hotspot coordinates.
