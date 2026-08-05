## class Graphics.Point

Data type, represents 2D point (also known as 2D vector).

```JS
const position1 = Point(10,10);
const position2 = Point.make(20,20); 
const position3 = Point(Rect(10,10,100,100)); // origin of the rect

// operators
const sum = Point(0,0) + Point(50,50); 
const sub = Point(0,0) - Point(50,50); // [-50,-50]
```

### constructor

Point instances can be constructed by `new Point(...)` or by `Point(...)` "convesrsion" constructor. 

* `Point()`  - constructs 0,0 point;
* `Point(Point)`  - constructs copy of the point;
* `Point(Size)`  - constructs point by converting it from _Size_;
* `Point(x,y)`  - constructs pont from two numbers;

### properties:

* `x` - number;
* `y` - number;
* `length` - number, length of the vector;


### methods:

* `point.distance(other:Point):number` 

returns distance between this and other point. 

* `point.distanceToLineSegment(lp1:Point, lp2:Point): [distance:number, lp: Point]`

Distance from this point to the line segment [_lp1_,_lp2_]. Returns the _distance_ and _lp_ - closest point to _this_ point on the line segment or lp1 or lp2 if this point projection falls outside the segment.


* `point.dot(Point): number`

returns [DOT product](https://www.mathsisfun.com/algebra/vectors-dot-product.html) of this and other points (vectors).

* `point.unit():Point`

returns normalized unit vector that goes in the same direction but has length of 1.

* `point.inscribe(Rect):Point`

moves (if needed) copy of the point inside the Rect, returns the copy.

### operators:

Point supports following operators:

* `point * n|size` - per component multiplication by number or size (scaling);
* `point / n|size` - per component division by number or size (scaling); 
* `point + point|size` - sum of two points (vectors);
* `point - point|size` - substraction of two points;
* `point == point` - equality of two points, implementation uses float EPSILON precision;
* `+point` - unary + (copy);
* `-point` - unary - (inversion);

### static methods:

 * `Point.make(x,y):Point`
 
Constructs point from x,y

