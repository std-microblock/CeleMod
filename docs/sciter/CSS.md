# CSS namespace

This namespace object contains CSS helper functions.

## Methods:

### `CSS.supports(prop,value):bool`

Reports if the engine supports given property name and value.

### `CSS.set(string):StyleSet`

Sciter specific, StyleSet constructor.

This function allows to construct style set objects at runtime. Primary purpose is to be used in Reactor components to define component styles in the same JS file as the component itself:

```JavaScript 

const h = 64;

const myStyles = CSS.set`
  :root { // the component itself
     width: 100px;
     height: ${h}px;
  }
  :root > span {
     color:red;
  } 
`;

class MyComponent extends Element {
  render() {
    return <div styleset={myStyles}>
       Hello <span>embedded</span> CSS
    </div>
  } 
}

```
Content of CSS.set literal is normal `@set`  declaration but without `@set name` preambula and without enclosing `{`,`}` brackets.