# class Event

## properties:

* `event.bubbles`
* `event.cancelable`
* `event.currentTarget`
* `event.defaultPrevented`
* `event.eventPhase`
* `event.target`
* `event.type`
* `event.data:any`
* `event.details:any` - alias of `event.data`
* `event.keyCode:integer` - key code, see include/sciter-x-key-codes.h
* `event.platformKeyCode` - platform's native key code, e.g, wParam in WM_KEYDOWN on Windows.
* `event.code` - string representation of keyCode `KeyA`, `F1`, `Enter`...
* `event.altKey` - ALT true/false
* `event.ctrlKey` 
* `event.metaKey` - `command key` on OSX, `win` on Windows
* `event.shiftKey`
* `event.isOnIcon` - mouse events, Sciter specific, _true_ if mouse is on element icon - `foreground-image` area, if it is defined by CSS.
* `event.button`
* `event.buttons`
* currentTarget relative coordinates:
  - `event.x`:number, CSS pixels
  - `event.y`:number, CSS pixels
  - `event.position`:[Point](../graphics/Graphics.Point.md), CSS pixels
  - `event.contentPosition`:[Point](../graphics/Graphics.Point.md), CSS pixels : `event.position + event.currentTarget.scrollPosition` 
* Client relative coordinates, relative to document container (window|frame):  
  - `event.clientX`:number, CSS pixels
  - `event.clientY`:number, CSS pixels
  - `event.clientPoisition`:[Point](../graphics/Graphics.Point.md), CSS pixels
* Window relative coordinates:
  - `event.windowX`:number, CSS pixels
  - `event.windowY`:number, CSS pixels
  - `event.windowPoisition`:[Point](../graphics/Graphics.Point.md), CSS pixels
* Screen relative coordinates, relative to whole desktop:
  - `event.screenX`:number, screen pixels 
  - `event.screenY`:number, screen pixels 
  - `event.screenPosition`:[Point](../graphics/Graphics.Point.md), screen pixels 
* Scroll (e.g. mouse wheel) deltas:
  - `event.deltaX` :number
  - `event.deltaY` :number
  - `event.delta`:[Size](../graphics/Graphics.Size.md)

* `event.deltaMode|int` - 0 - deltaX/Y are pixels coming from touch devices, 1 - deltaX/Y are in `lines` (a.k.a. mouse wheel `ticks`). 
* `event.relatedTarget` - only for blur|focus|focusin|focusout events, see: [relatedTarget](https://developer.mozilla.org/en-US/docs/Web/API/FocusEvent/relatedTarget).

### properties (Sciter specific):

* `event.x` - sciter specific, coordinates are relative
* `event.y` - to `event.currentTarget` - the element this event handler is attached to.
* `event.source` - used in some events to indicate auxiliary `source` element. 
* `event.isOnIcon:Element` - mouse events, it is set to element when mouse is on icon of that element. Element icon is an element's foreground-image (if any) so event.isOnIcon is on when mouse is over area where the image is rendered.

### properties (Sciter specific, gestures):

- `event.delta:[Size](../graphics/Graphics.Size.md)` pan gesture deltas, in logical (CSS) pixels;
- `event.deltaZoom:float`  zoom gesture delta zoom multiplier: `currentScale *= evt.deltaZoom`;
- `event.deltaRotation:Angle`  zoom gesture delta angle: `currentRotation += evt.deltaRotation`;

## methods:

* `event.preventDefault()`
* `event.stopImmediatePropagation()`
* `event.stopPropagation()`

## static methods:

* `Event.keyState(key:string): true|false|undefined` 

  Returns pressed status of the _key_. Example:

  ```JS
    if(Event.keyState(`CapsLock`))
      ... CAPS LOCK is on ...
  ```

## Known Events

### Mouse

* `mousemove`
* `mouseenter`
* `mouseleave`
* `mouseidle` - mouse stays not moving in the element, the event triggers tooltip show.
* `mousetick` - mouse is pressed for some time in element, periodic event
* `mousedown`
* `mouseup`
* `mousewheel`
* `mousedragrequest`
* `dblclick` | `doubleclick`
* `tripleclick`

### Behaviors

* `click`
* `input` - posted event, arrived after user changes something.
* `change` - synchronous event, arrived on user's change and before screen update.
* `press` 
* `changing` 
* `submit` 
* `reset`  
* `expand`  
* `collapse`  
* `statechange` 
* `visualstatechange` 
* `disabledstatechange` 
* `readonlystatechange` 

* `navigation` 
  
  The event is generated in response of click on a hyperlink.  `event.data` is an object `{ url:string, target:string }`. 
  Consuming this event in sinking phase will prevent default loading of target document into window or frame.

* `contextmenu` - context menu request for the element
* `contextmenusetup` - notification to setup context menu, context menu DO< element is event.source

* `animationend`
* `animationstart` 
* `animationloop` 

* `transitionend`
* `transitionstart` 

* `mediachange` 
* `contentchange` 
* `inputlangchange` 
* `pastehtml` 
* `pastetext` 
* `pasteimage` 
* `popuprequest`  
* `popupready`    
* `popupdismissing` 
* `popupdismissed`  

* `tooltiprequest` 

### Focus

* `focusin`
* `focusout` 
* `focus` 
* `blur` 

### Keyboard

* `keydown`
* `keyup`  
* `keypress`
* `compositionstart`
* `compositionend`

### Scroll

* `scroll`
* `scrollanimationstart` 
* `scrollanimationend` 

### Gestures

Set of events coming from touch devices - touchpad/trackpad or touchscreen.

* `gesture-start`
  
  the event is sent when first touch contact is made. 

  Element that receives that event may call `element.state.wantsGestures(...)` method to define gestures it want to receive.
  
  `element.state.wantsGestures(event1,event2,...)` accepts list of events of gestures the element wants to receive:

  * `"pan-vertical"` - vertical scroll
  * `"pan-horizontal"` - horizontal scroll
  * `"zoom"` 
  * `"rotation"`
  * `"tap1"` - single finger tap
  * `"tap2"` - two finger tap
  * `"long-tap"`
  * `"double-tap"`
  
  Note: `element.state.wantsGestures()` method is expected to be called in `gesture-start` event handler.

* `gesture-end`

  the event is sent after last touch contact is removed. 

* `gesture-press`

  the event is sent when the element is touched. For eaxample Android shows expanding circle animation on such event. 

* `gesture-tap`
  
  the event is sent when the element is touched and detouched without significant move. 

* `gesture-doubletap`

  the event is sent when the element is taped twice. 

* `gesture-longtap`

  the event is sent after the element is taped with significant delay between touch down and up moments. 

* `gesture-zoom`
  
  the event is sent on zoom (a.k.a. magnification) gesture by two fingers. 

  `event.deltaZoom` multiplier can be used to change zoom (a.k.a. scale) factor:

  ```JavaScript
  let zoom = 1;
  ...
  element.on("gesture-zoom", event => zoom *= event.deltaZoom);
  ```

* `gesture-rotation`

  the event is sent on rotation gesture by two fingers. 

  `event.deltaRotation:Angle` is the delta angle that needs to be added to current rotation angle. 

* `gesture-pan`

  the event is sent on pan (scroll) gesture detection. `event.delta` needs to be added to current scroll position.

* `gesture-swipe`

  the event is sent after fast pan (scroll) gesture. `event.delta` is an exit speed (pixels per second). On scrollable elements Sciter starts kinetic scroll animation.

### Document lifecycle events

Loading:

* `parsed` - document just got a DOM structure, scripts are not run yet. This event can be handled by document container only (window or frame). 
* `ready` | `DOMContentLoaded` - document loaded, DOM is parsed, scripts are loaded and run.
* `complete` - document loaded in full scripts were run, all resources defined in HTML are loaded.

Closing:

* `close` | `unload` - document is closed and about to be deleted soon.
* `beforeunload` - document is about to be unloaded, script namespace is still operational.
* `closerequest` - first phase of document closure, it can be rejected at this point by calling `event.preventDefault()`.

### Element's state change

* `sizechange` - not bubbling event, change of element dimensions;
* `visibilitychange` - not bubbling event, change of element visibility status;

### Image

* `load`
* `error`

### Pager (print preview)

* `paginationstart`
* `paginationpage` 
* `paginationend` 

### Drag-n-drop

* `drag`
* `dragenter` 
* `dragleave` 
* `drop` 
* `dragcancel` 
* `dragaccept` 
* `willacceptdrop`

### Video

* `play`
* `ended`

* `videocoordinate`
* `videoframeready`

## MISC

- [Event handling in Sciter](https://sciter.com/event-handling-in-sciter/)
