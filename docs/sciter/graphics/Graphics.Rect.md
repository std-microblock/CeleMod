## class Graphics.Rect

Data type, represents 2D rectangle.

```JS
const emptyBox = Rect();
const box1 = Rect(10,10,100,100); // origin 10/10 , size 100/100
const box2 = Rect.make(10,10,100,100); // origin 10/10 , corner 100/100
const box3 = Rect(Point(10,10),Size(100,100)); // origin 10/10 , corner 100/100

// operators
const intersection = Rect(0,0,100,100) & Rect(50,50,100,100); // Rect(50,50,50,50)
const union = Rect(0,0,100,100) | Rect(50,50,100,100); // Rect(0,0,150,150)
```

### constructor

Rect instances can be constructed by `new Rect(...)` or by `Rect(...)` "convesrsion" form. 

* `Rect()`  - constructs empty rectangle;
* `Rect(Point)`  - constructs empty rectangle with its origin set to the point;
* `Rect(Size)`  - constructs rectangle with its origin set to [0,0] and size to the _Size_;
* `Rect(Point,Size)`  - constructs rectangle with its origin set to the _Point_ and size to the _Size_;
* `Rect(Point,Point)`  - constructs rectangle with its origin and corners set to the _Point_ s;
* `Rect(Size,Size)`  - constructs rectangle with its origin and corners set to the _Size_ s;
* `Rect(Rect)`  - constructs copy of the rectangle;
* `Rect(x,y,w,h)`  - constructs rectangle from four numbers;

### properties:

* `x` - number, origin.x 
* `y` - number, origin.y 
* `width` - number, size.x 
* `height` - number, size.y 

* `left` - number, origin.x  
* `top` - number, origin.y  
* `right` - number, corner.x  
* `bottom` - number, corner.y  

* `origin` - Point, top/left point of the rectangle 
* `corner` - Point, bottom/right point of the rectangle 

* `size` - Size, dimension of the rectangle 

### methods:

* `pointOf(which:int):Point` 

returns one of nine points of the rectangle. 

_which_ is a number in range 1 ... 9, see NUMPAD numbers on keyboard: 7 - top/left, 5 - center, etc.  

* `moveTo(pos:Point [,which = 7]): Rect`

returns new rectangle, copy of this rect, by moving its _which_ point to the _pos_.

```
  const rc = Rect(Point(10,10), Size(10,10));
  const moved = rc.moveTo(Point(10,10),3); 
  // moved origin == Point(0,0);
```

* `isEmpty(): bool`

  returns _true_ if the rectange is empty.

* `overlaps(Rect): bool`

  returns _true_ if this rect overlaps the other rect. Equivalent of `!(thisRect & otherRect).isEmpty()`

* `contains(Rect): bool`

  returns _true_ if this rect contains the other rect in full. Equivalent of `!(thisRect & otherRect) == otherRect`

* `distance(Point): float`

  returns minimal distance between the rectangle and the point, or zero if the point is inside the rectangle.

* `normalize(): Rect`

  returns normalized copy of the rectangle so rect.origin < rect.corner and rect.size >= 0.

* `inflate(Size): Rect`
* `inflate(topleft:Size, bottomright: Size): Rect`

  returns inflated copy of the rectangle by moving rectangle points outwards.

  `thisRect.inflate(Size)` is equivalent of `newRect = thisRect >> Size`.

* `deflate(Size): Rect`
* `deflate(topleft:Size, bottomright: Size): Rect`

  returns deflated copy of the rectangle by moving rectangle points inwards.
  
  `thisRect.deflate(Size)` is equivalent of `newRect = thisRect << Size`.

### operators:

Rect supports following operators:

* `rect * n|size` - multiplication by number or size (scaling);
* `rect / n|size` - division by number or size (scaling); 
* `rect + point|size` - move the rect by the size;
* `rect - point|size` - move the rect by the size;
* `rect == rect` - equality of two rectangles, implementation uses float EPSILON precision;
* `rect << n|size` - deflate the rect by number or size;
* `rect >> n|size` - inflate the rect by number or size;
* `rect | rect` - union of two rects, returns smallest outline rect that includes both rects
* `rect & rect` - intersection of two rects, returns largest rect that is contained in both rects. May return empty rectangle in case of no intersection.

### static methods:

 * `Rect.make(x1,y1,x2,y2):Rect`
 
   Static constructor that constructs the rect from origin (x1,y1) and corner (x2,y2) points.
 
 * `Rect.make(Point,Size):Rect`
 
   Static constructor that constructs the rect from origin point and size.
 
 * `Rect.make(Point,Point):Rect`
 
   Static constructor that constructs the rect from origin and corner points.
 
 