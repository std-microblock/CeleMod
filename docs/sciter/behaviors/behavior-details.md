# behavior: details

This helper behavior implements switchable details/summary logic behind HTML5 `<details><summary>` element.

Click on `<summary>` or `<caption>` element causes switch between `:collapsed` and `:expanded` states.

## Elements

By default the behavior is applied to standard HTML5 `<details>` element:

```HTML
<details>
    <summary>Details</summary>
    Something small enough to escape casual notice.
</details>
```

but in Sciter you can apply it to any element, style: 

```CSS
li {
  behavior:details;
}
li > p { visibility:none; }
li:expanded > p { visibility:visible; }
```
and HTML:

```HTML
<li>
   <caption>Summary</caption>
   <p>Details</p>
</li>
```

Click on `<caption>` causes that LI element item to be switched between  `:expanded` and `:collapsed` states showing or hiding `<p>` sub element according to the CSS. 

## Attributes

* "open" - either empty attribute or with values "true" or "false".

## Events

* "expand" - this event is posted when an item gets `:expanded` flag. `event.target` is the list item. 
* "collapse" - this event is posted when an item gets `:collapsed` flag. `event.target` is the list item. 

## Value

N/A

## Methods

N/A

## Samples

* samples.css/css++behaviors/details.htm
* samples.css/css++behaviors/details-summary.htm