
## Reactive Signals

TL;DR: Signals in Sciter/Reactor are observable values that application can subscribe on.


In essence, a `signal` is an object with a `.value` property that holds a value. This has an important characteristic: a signal's value can change, but the signal itself always stays the same:

```JavaScript
const { signal } = Reactor;

// signal with initial value 0:
const count = signal(0); 

// Read a signal’s value by accessing .value:
console.log(count.value);   // 0

// Update a signal’s value:
count.value += 1;

// The signal's value has changed:
console.log(count.value);  // 1
```

The main feature is that **signals are subscribable**, so other parts of the application can be invoked autmatically when value of the signal changes. 

Sciter supports four types of signal subscribers:

1. **effect functions** - functions that will be invoked on change of signal(s) value:

   ```JavaScript
   const { signal, effect } = Reactor;

   const count = signal(0); 
  
   // effect function declaration, will log each change of the count
   effect( () => console.log(`Invoked ${count.value} times`) );
   ```
   > Note: there is no explicit "subscribe" call or anything like that, runtime detects signal.value getter invocations and subscribes the effect function to all signals involved.  


2. **computed signal-functions** - functions that are a) signals by themselves and b) are invoked when signal(s) value change:

   ```JavaScript
   const { signal, computed, effect } = Reactor;

   const name = signal("John");
   const surname = signal("Smith");
   const fullName = computed(() => `${name.value} ${surname.value}`);
  
   // Logs name every time either name or surname change
   effect(() => console.log(fullName.value));
   // Logs: "John Smith"
   ```

3. **Reactive components**:

   ```JavaScript
   const { signal } = Reactor;

   const clickCounter = signal(0); 

   function ButtonCounter() { // func
     return <div>
        <button onClick={ () => clickCounter.value++} >Click me</button>
        <span>The button clicked {clickCounter.value} times</span>
     </div>;
   }

   document.body.append(<ButtonCounter/>);
  
   ```
   Note: the ButtonCounter component will be rerendered each time clickCounter changes by any means.


3. **Signal bound input elements** - value property of an input element can bound with a signal in bidirection (duplex) manner.  

   ```JavaScript
   const { signal } = Reactor;

   const count = signal(0); 

   function Counter() { // func
     return <div>
        Counter <input|integer value={count} /> 
      </div>;
   }

   document.body.append(<Counter/>);
  
   ```
   When the user will change value of the `<input>`, the signal will be activated informing potential other observers.

   In the same way if code will change value of the signal it will be reflected on UI. NOTE: such input value update from code side will be performed only if the input is not in focus.

## Signal API

The Signal API consists of three functions in Reactor namespace:

* `Reactor.signal(initialValue)`
* `Reactor.computed(fn)`
* `Reactor.effect(fn)`
* `Element.signal(initialValue)` - "component signal"

Note: you can always make shortcuts of these functions:

```JavaScript
const { signal, computed, effect } = Reactor;
...
```

### signal(initialValue)

Creates a new signal with the given argument as its initial value:
```JavaScript
const count = signal(0);
```

The returned signal is an instance of [Signal] class that has a `.value` property that can be get or set to read and write its value. To read from a signal without subscribing to it, use `signal.peek()`.

**Note:** you shall always assign result of the `signal()` call to some variable. This variable will hold the signal. As soon as the variable goes out of scope the signal will be destroyed invalidating any observers. 

### computed(fn)

Creates new composite signal that is computed based on the values of other signal[s]:
```JavaScript
const name = signal("Jane");
const surname = signal("Doe");

const fullName = computed(() => `${name} ${surname}`);
```

**Note:** signal values in R-value expressions can be used just by names of signal variables, like the last statement above. It is an equivalent of 

```JavaScript
const fullName = computed(() => `${name.value} ${surname.value}`);
```

### effect(fn)

To run arbitrary code in response to signal changes, we can use `effect(fn)`. Similar to computed signals, effects track which signals are accessed and re-run their callback when those signals change. 

The `effect()` function returns Signal instance that you can use to `.dispose()` the effect - stop it from tracking changes.  

### element.signal(initialValue)

Creates new signal object with the given argument as its initial value. The signal is associated with the element and have lifespan of that element.
It can be used for example in functional components:
```HTML
<html>
    <head>
        <title>Counter</title>
        <script type="module">
            function Counter() {
                const count = this.signal(0);
                return (
                    <div>
                        <p>Count: {count}</p>
                        <button onclick={() => ++count.value}>click me</button>
                    </div>
                );
            }
            document.body.append(<Counter />);
        </script>
    </head>
    <body></body>
</html>
```

## Signal Object

Signal objects returned by the `signal()`, `computed()` and `effect()` functions have the following properties and methods:

* `signal.value:any` - property, read/write, access to payload of the signal. On assignment, if value changes it will fire the signal, notifying all subscribers.
* `signal.send(value:any)` - the function will fire the signal unconditionally, even if the signal has this value already.
* `signal.dispose()` - the function stops signal operation - frees all links and references. Rarely used.
* `signal.peek():any` - the function returns value without subscription of the signal to anything.
* `signal.valueElements: array` - property, readonly, returns list of DOM input elements where this signal is used as a value.
* `signal.observingElements: array` - property, readonly, returns list of DOM elements that are observing this signal.
