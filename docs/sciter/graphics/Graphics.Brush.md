# class Graphics.Brush

Represents painting brushes: solid, gradient, bitmap, etc.

## Properties:

* `brush.type:integer` - reports brush type;

## Methods:

### `brush.addColorStop(pos:0.0...1.0, color: Color):brush`

Adds color stop to gradient brushes.

### Static (Class) Methods:

### `Brush.createLinearGradient(x1, y1, x2, y2): Brush`

Creates linear gradient brush along the line from x1/y1 to x2/y2.

### `Brush.createRadialGradient(x, y, r): Brush`

Creates radial gradient brush with center at x/y and radius r.

### `Brush.createTile(img:Image): Brush`

Creates tiled image brush.

### `Brush.createSolid(clr:Color): Brush`

Creates solid color brush.
