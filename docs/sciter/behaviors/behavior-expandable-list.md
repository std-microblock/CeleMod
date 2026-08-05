# behavior: expandable-list

This helper behavior implements logic of "expandable" list where only one list item is `:expanded` at a time.

## Elements

By default the behavior is not applied to any element - you should assign it explicitly in CSS:

```CSS
div.list {
  behavior:expandable-list;
}
```

## DOM Model

The list element is assumed to contain child element (list items) with `<caption>` element inside:

```HTML
<div.list>
   <section dafault>
      <caption>A</caption>
      <div>...details...</div>
   </section>
   <section>
      <caption>B</caption>
      <div>...details...</div>
   </section>
   ...
</div>
```

Click on `<caption>` causes corresponding list item to get `:expanded` state flag and all others to be set to `:collapsed` state. 

## Attributes

Initial item that needs to be `:expanded` by default should have "default" attribute set.

## Events

* "expand" - this event is posted when an item gets `:expanded` flag. `event.target` is the list item. 
* "collapse" - this event is posted when an item gets `:collapsed` flag. `event.target` is the list item. 

## Value

N/A

## Methods

N/A

## Samples

* samples.css/css++behaviors/expandable-list.htm

