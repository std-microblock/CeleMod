# CSS Layout

Sciter use different layout engine than what is used in browsers.


## Flow/Flex

### Basic flow

`flow : vertical|vertical-wrap|horizontal|horizontal-wrap`

* `flow:vertical` - child elements replaced in vertical direction forming single column.
* `flow:horizontal` - child elements replaced in horizontal direction forming single row.
* `flow:vertical-wrap` - child elements replaced in vertical direction wrapping child blocks in multiple columns. The element shall have defined `height` property in order wrapping to work.
* `flow:horizontal-wrap` - child elements replaced in horizontal direction wrapping child blocks in multiple rows. The element shall have defined `height` property in order wrapping to work.

### Grid flow

Space seperated quotes defining columns, inside the quotes are element indexes defining rows.

Indexes start with `1`, use `0` to define empty space.

```CSS
flow: grid(1 2,   //| 1 | 2 |
           1 3);  //| 1 | 3 |     
```

will replace elements according to the template. Elements may span multiple columns and rows.

The `grid()` function accepts integers - indexes of child elements. 
Arguments define 2d matrix - lists where `,` separate row defintions. 


### Row

Alternative form of grid definition.

`flow:row()` function arguments are comma seperated element names; space seperated names operate as OR statement:

So this

```CSS
flow: row(label, input select, button); //| <label> | <input or select> | <button> |
```

will put all _label_ elements in the first column, _input_ or _select_ elements in the second and _button_ s in the third column.

Elements that are not in the list will be replaced as a full row spaning all columns.


#### `flow-columns` and `flow-rows`

These properties define lists of column/row size defintions of the grid.

`flow-columns: <width-def> <width-def> <width-def> ...;`
`flow-rows: <height-def> <height-def> <height-def> ...;`

Where _width-def_ and _height-def_ are one of these:

* _length_ - literal width of the column or height of the row, examples: `20px`, `4em`;
* _flex_ - flex width of the column or height of the row, example: `*`, `2*`;
* _percent_ - width/height in percent of the container, example: `50%`;
* `fx( flex-weight, min-length, max-length)` - same as _flex_ but with min and max limits, example: `fx(1,100px,300px)` column will flex between 100px and 300px with flex weight equal to `1*` (or just `*`);
* `repeat( N:integer, def: length | flex | percent | fx())` - repeat def(inition) N times. Short form for defining repeatable definitions, example: `repeat(3,200px)` - three columns will have wifths of 200px each;

## Align

### Basic content alignment

- `horizontal-align` : `center|left|right|start|end`
- `vertical-align` : `middle|top|bottom|start|end`

### Element positioning inside grid cells

* `display:block` elements span whole grid cell, margins declared on element participate in inter-cell spacing.
* `display:inline-block` elements may have smaller than cell sizes. In such case margins define distance between cell box and borders of the element inside the cell. Margins defined in flex units allow to align arbitrary element inside the cell. 

Example: 

```CSS
div {
  display:inline-block;
  width: 4em;
  margin-left:*;
  margin-right:0;
  margin-top:*;
  margin-bottom:0;
}
```
will replace the div in right/bottom corner of the cell.

## Spacing

```CSS
border-spacing: length | flex;
```
Defines spacing between all direct child elements (inter-cell spacing);

## Misc

- [Sciter flex vs flexbox](https://terrainformatica.com/w3/flex-layout/flex-vs-flexbox.htm)

- [flex layout](https://sciter.com/docs/flex-flow/flex-layout.htm)

- `sciter-js-sdk\samples.css\css++` for more samples

