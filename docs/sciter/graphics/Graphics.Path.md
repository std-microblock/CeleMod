# class Graphics.Path

Represents 2D path. Also known as Path2D in browsers.

## Constructor

`new Graphics.Path([d:string])`

Constructs new path object. _d_ accepts SVG's `<path>`s [d attribute value](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d).

## Properties

N/A

## Methods

* ### `path.moveTo(x, y)`, `path.moveTo(Point)`
* ### `path.lineTo(x, y)`, `path.lineTo(Point)`
* ### `path.quadraticCurveTo(cpx, cpy, x, y)` `path.quadraticCurveTo(cp:Point, p:Point)`
* ### `path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y)` `path.bezierCurveTo(cp1:Point, cp2:Point, p: Point)`
* ### `path.arc(x, y, radius, startAngle, endAngle [, anticlockwise])`
* ### `path.arcTo(x1, y1, x2, y2, radius)`
* ### `path.ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle [, anticlockwise])`
* ### `path.rect(x, y, width, height)`, `path.rect(Rect)`, `path.rect(Point,Size)`
* ### `path.closePath()`

* ### `path.isPointInside(x,y):bool`
* ### `path.isPointInside(Point):bool`
  _true_ if the point is inside the (closed) path
* ### `path.isPointOnStroke(distance,x,y):bool`
* ### `path.isPointOnStroke(distance,Point):bool`
  _true_ if the point is in _distance_ from the stroked path  
* ### `path.box(): Rect`
  Outline box as a rectangle
* ### `path.bounds(): [x1,y1,x2,y2]`
  Outline box as x1,y1,x2,y2 a quad
* ### `path.combine(how:string, otherPath): Path`
  
  combines this and other paths using following _how_ modes:

  * `"union"` 
  * `"intersect"`
  * `"xor"`
  * `"exclude"`

