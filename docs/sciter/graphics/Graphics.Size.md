## class Graphics.Size

Data type, represents 2D size (dimension).

```JS
const sz1 = Size(10,10);
const sz2 = Size.make(20,20); 
const sz3 = Size(Rect(10,10,100,100)); // size of the rect, 100,100

// operators
const sum = Size(0,0) + Size(50,50); 
const sub = Size(0,0) - Size(50,50); // [-50,-50]
```

### constructor

Size instances can be constructed by `new Size(...)` or by `Size(...)` "convesrsion" constructor. 

* `Size()`  - constructs 0,0 point;
* `Size(Size)`  - constructs copy of the point;
* `Size(Size)`  - constructs point by converting it from _Size_;
* `Size(x,y)`  - constructs pont from two numbers;

### properties:

* `x` - number;
* `y` - number;
* `width` - number, alias of _x_;
* `height` - number, alias of _y_;
* `length` - number, length of the vector;

### methods:

* `distance(other:Size):number` 

returns distance between this and other point. 

* `dot(Size): number`

returns [DOT product](https://www.mathsisfun.com/algebra/vectors-dot-product.html) of this and other points (vectors).

* `normalize():Size` 

returns normalized size with x and y >= 0. 


### operators:

Size supports following operators:

* `point * n|size` - per component multiplication by number or size (scaling);
* `point / n|size` - per component division by number or size (scaling); 
* `point + point|size` - sum of two points (vectors);
* `point - point|size` - substraction of two points;
* `point == point` - equality of two points, implementation uses float EPSILON precision;
* `+point` - unary + (copy);
* `-point` - unary - (inversion);

### static methods:

 * `Size.make(x,y):Size`
 
static constructor that constructs the point from x, y.