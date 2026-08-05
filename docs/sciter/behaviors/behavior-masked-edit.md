# behavior: masked-edit

This behavior provides masked input editing functionality - editable "islands" separated by static text.

## Elements

that have this behavior applied by default to:

* `<input type="masked">`
* `<input|masked>`
* `<input|date>/<caption>` \- on caption sub-element of date input;
* `<input|time>/<caption>` \- on caption sub-element of time input;

## Model

Upon initialization the input contains following structure:

```XML
<input|masked>
  <span>editable</span>
  separator
  <span>editable</span>
  separator
  ...
</input>
```

`<span>` elements represent editable text and text nodes represent static separators.

Current editable span will have `:current` state flag. Numeric span with invalid value (more than *max* or less than *min*) is marked by `:invalid` flag.

## Attributes

* `value="text"` \- initial text value;
* `mask="mask"` \- definition of mask that is a text that may contain special characters:
  * `\_` (underscore) - allows input of any alphanumeric character at this position;
  * `@` \- allows input of any alpha character at this position;
  * `#` \- allows input of any numeric character at this position;
  * `0` \- numeric input, the field will be zero padded on set;
  * all other character in the mask will be rendered as a static separator text.

## Methods

### `masked.selectGroup(group:int)`

Selects particular editing group.

### `masked.selectAll()`

Selects all editing groups.

### `masked.getGroupValue(group:int | undefined):value`

Reports current value of the group. If _group_ is undefined returns value of current group.
The value can be a string, number or undefined - depends on group type.

### `masked.setGroupValue(group:int | undefined, value):bool`

Sets current value of the group. If _group_ is undefined sets value of current group.
The value can be a string, number - depends on group type. Setting value to _undefined_ - clears the group value.

### `masked.groupType(group:int | undefined):string`

Reports type of the group. If _group_ is undefined returns type of current group.
Possible values:

* `"_"` - alpha-numeric text;
* `"@"` - alpha text;
* `"#"` - number (integer);
* `"0"` - number with zero padding;
* `"|"` - enumeration;

## Properties

* `masked.groupsCount:int` - read-only, number of groups (editable fields);
* `masked.currentGroup:int` - read-write, current group number;

* `masked.value:array` - read-write, so called raw value - array of group values.

* `masked.mask` - read/write property, either a **string** or an **array** of definitions;
  
  This property allows to define structure of masked input "manually" and with more control.
  
  Mask definition is an array of strings (rendered as static separators) and objects. Each object defines editable regions and may have following fields:
  
  
  * `type: #integer | #text | #enum`\- defines type of the region, mandatory;
  * `width: integer` \- defines length of the region in characters, mandatory;
  * `class: string | symbol` \- defines CSS class of generated span element, optional;
  * `min,max,step : integer` \- define min/max/step values for type:#integer, optional;
  * `leading-zero : true | false` \- if true then this type:#integer field is prefixed by zeros
  * `items:\["case1","case2",...\]` \- defines list of enumerable cases for type: #enum - this region allows to input only those predefined cases. Mandatory for type:#enum fields.
  * `filter: "a~z"` \- defines filter of allowed characters in this type:#text field, optional.
: 

## Events

* `"change"` | `"input"` - posted when value is changed.
* `"statechange"` - posted when editor highlights other editable group.

## Value

Is either `string` or `array of values`  when mask was defined by `this.masked.mask = \[definitions\]` call.

## Examples

Declaration of IP4 address input field:

```XML
<input|masked mask="000.000.000.000">
```

More precise declaration of IP4 address input field using aspect function for initialization, markup:

```XML
<input|masked.ip4 mask="000.000.000.000">
```

CSS:

```CSS
input.ip4 { aspect:IP4 }
```

Script:

```JavaScript
function IP4() {
  const ipmask = [
            { type:"integer", width:3, min:0, max:255, "leading-zero":true }, ".",
            { type:"integer", width:3, min:0, max:255, "leading-zero":true }, ".",
            { type:"integer", width:3, min:0, max:255, "leading-zero":true }, ".",
            { type:"integer", width:3, min:0, max:255, "leading-zero":true } ];
  this.masked.mask = ipmask; // initialization of fields and separators
}
```

