DataBaxe
========

A modern data request and store tool for frontend.
Make it more easy to manage data sources in js app.

## Install

```
npm i -S databaxe
```

## Usage

ES6:

```js
import DataBaxe from 'databaxe'
```

CommonJS:

```js
const { DataBaxe } = require('databaxe')
```

Browser:

```html
<script src="node_modules/databaxe/dist/databaxe.bundle.js"></script>
<script>
const { DataBaxe } = window.databaxe
</script>
```

## Usage

```js
const dbx = new DataBaxe(settings)
```

```js
export default class MyComponent {
  constructor() {
    // step 1: initialize a instance
    this.dbx = new DataBaxe()

    // step 2: register datasources
    this.dbx.register({
      id: 'myid',
      url: '/api/v2/users',
      options: {
        headers: {
          'Access-Token': 'xxxx-xxx',
        },
      },
      expire: 60*1000, // 1 min
    })

    // step 3: subscribe change callbacks
    this.dbx.subscribe('myid', () => {
      this.render()
    })

    this.render()
  }
  async render() {
    // step 4: use data
    let users = await this.dbx.get('myid')

    // now, use `users` to render
    // ...
  }
  async add(user) {
    // step5: save data to backend api
    await this.dbx.save('myid', user) // post
    await this.dbx.get('myid', null, true) // force update, trigger this.render
  }
}
```

**settings**

Pass settings into databaxe constructor.

```js
const dbx = new DataBaxe(settings)
```

It will be merged with `DataBaxe.defaultSettings`.

```js
DataBaxe.defaultSettings = {
  debug: false,
  expire: 0, // cache expire time for `get` method
  debounce: 10, // debounce time for `save` mehtod, should bigger than 10
  store: { // storage options for hello-storage
    namespace: 'databaxe',
    storage: null,
    stringify: false,
  },
  options: { // default options for axios
    baseURL: '', // backend url base
  },

  onInit: null, // after init
  onRegister: null, // after data source registered
  onUpdate: null, // after saving to store
  onRequest: null, // before ajax send
  onResponse: null, // after ajax back
}
```

## Methods

### register(datasources)

Register datasources in databaxe,
notice, data is shared with other instances of databaxe.

It is ok if you pass only one datasource here.

**datasource**

_object_

```js
const datasource = {
  id: 'xxx', // string, identifation of this datasource, can be only called by current instance
  url: '/api/users', // string, url to request data,
    // you can use interpolations in it, i.e. 'https://xxx/{user_name}/{id}',
    // and when you should call `.get('xxx', { fillers: { user_name, id } })`
    // if you pass relative url, it will be connected with options.baseURL
  transform: (data) => {}, // function, transform your data after getting data from store,
    // you should pass a bound function or an arrow function if you use `this` in it.
    // transform function should be pure functions!!! don't modify the original data in it.
  take: (res) => {}, // handle ajax response. don't modify the response data in it.
  expire: 10*1000, // number, cover settings.expire
  debounce: 10, // number, cover settings.debounce
  options: {}, // axios options, cover settings.options
}
```

When you `.get` or `.save` data, this datasource info will be used as basic information.

### subscribe(id, callback, priority = 10)

Add a callback function in to callback list.
Notice, when data changed (new data requested from server side), all callback functions from components will be called.

**id**

Datasource id.

**callback(data, options)**

Callback function when request successfully from backend data api, and new data is put into store.

- data: new data from api
- options: axios options, options.method should not be 'put', 'delete', 'patch'

```js
dbx.subscribe('myid', (data) => {
  console.log(data)
})
```

With `options`:

```js
dbx.subscribe('myid', (data, options) => {
  let fillers = options.feilds || {}
  if (fillers.userId === 112) {
    console.log(data)
  }
})

dbx.get('myid', { feilds: { userId: 112 } })
```

**priority**

The order of callback functions to run, the bigger ones come first. Default is 10.

### unsubscribe(id, callback)

Remove callback, so do not use anonymous functions as possible.

If callback is 'undefined', all callbacks of this datasource will be removed.

You must to do this before you destroy your component, or you will face memory problem.

### dispatch(id, data, options)

_DO NOT USE THIS METHOD IF YOU DO NOT SURE WHAT IT WILL DO._

Save data to store to replace old data.
Call all callback functions which are appended to this data source's callback list.
You SHOULD notice that, not only this DataBaxe intance's callbacks, but also all callbacks of others will be triggered.

### get(id, options, force)

Get data from store and return a Promise instance.

If data is not exists, it will request data from server side.
Don't be worry about several calls. If in a page has several components request a url at the same time, only one request will be sent, and all of them will get the same Promise instance and will be notified by subscribed callback functions.

When the data is back from server side, all component will be notified.

If `expire` is set, data in store will be used if not expired, if the data is expired, it will request again which cost time (which will trigger callback).
If not set, data in local store will always be used if exist, so it is recommended to set a `expire` time.

If there is data in store, and expired, and request fail, local store data will be used again.
A warn message will be throw out in console if `debug` is true.

**options**

Request options which will be used by _axios_, if you want to use 'post' method, do like this:

```js
dbx.get('myid', {
  method: 'post',
  data: { key: 'value' },
}).then((data) => {
  // ...
})
```

To interplote into URL, you should pass `options.fillers` ti replace interpolations in URL. For example:

```js
// datasource.url = '/api/v2/users/{userId}
dbx.get('user_by_id', {
  fillers: { userId: 123 },
}).then((data) => {
  // ...
})
```

`fillers` is not needed by axios, so it will be removed when axios send ajax.

**force**

Boolean. Wether to request data directly from server side, without using local cache:

```js
dbx.save('myid', myData).then(async () => {
  let data = await dbx.get('myid', null, true)
})
```

Notice: when you forcely request, subscribers will be fired after data come back, and local store will be update too.
So it is a good way to use force request when you want to refresh local cached data.

### save(id, data, options)

To save data to server side, I provide a save method. You can use it like put/post operation:

```js
dbx.save('myId', { name: 'lily', age: 10 })
```

Notice: save method will not update the local store data. If you want to update data in store, use `get` with `force=true`.

**data**

post data.

**options**

The same as `get` options.


**@return**

This method will return a promise which resolve response, so you can use `then` or `catch` to do something when request is done.

`.save` method has some rules:

1. options.data will not work
2. when options.method=delete no data will be post
3. several save requests will be merged during debouncing
4. if options.method is not set, `POST` will be used, `GET` is not alllowed

We use a simple transaction to forbide save request being sent twice/several times in a short time.
If more than one saving request happens in debounce time, post data will be merged, and the final request send merged data to server side.
So if one property of post data is same as another saving request's, the behind data property will be used, you should be careful about this.
If you know react's `setState`, you may know more about this transaction.

### autorun(funcs)

Look back to the beginning code, step 3 & 4.
I use subscribe to add a listener and run `this.render` in it.
This operation makes me unhappy. Why not more easy?

Now you can use `autorun` to simplify it:

```js
export default class MyComponent {
  constructor() {
    this.dbx = new DataBaxe()
    this.dbx.register({
      id: 'myid',
      url: 'http://xxx/{id}',
      expire: 60*1000, // 1 min
    })

    this.render = this.render.bind(this)
    this.autorun(this.render)
    // yes! That's all!
    // you do not need to call `this.render()` again, autorun will run the function once at the first time constructor run.
    // and will be triggered automaticly when data change
  }
  render() {
    let data = this.dbx.get('myid', { id: '111' })
    // ...
  }
}
```

**funcs**

Array of functions. If you pass only one function, it is ok.

To understand how `autorun` works inside, you can learn about [mobx](https://github.com/mobxjs/mobx) autorun first.

### autofree(funcs)

Freed watchings which created by `autorun`.
You must to do this before you destroy your component if you have called `autorun`, or you will face memory problem.

### destroy()

You should destroy the instance before you unmount your component.

### alias(id, fn, type)

When you want to combine some operators, you can use alias to create a data alias source.

```js
dbx.alias('myalias', function() {
  return Promise.all([
    this.get('data1'),
    this.get('data2'),
  ]).then(([data1, data2]) => {
    return { data1, data2 }
  });
})

let somedata = await dbx.get('myalias')
```

`type` should be `get` or `save`, default is `get`.
And alias source will not be subscribed.

## Shared datasource

When using register, you should give `url` and `options`.
We can identify a datasource with url+options.
If two component register datasources with same url+options, we treat they are the same datasources,
data of these datasources are shared, and when one component get data which fire requesting, the other one will be notified after data back.

In componentA:

```js
this.dbx.register({
  id: 'ida',
  url: 'aaa',
  options: {
    headers: {
      'Auth-Token': 'xxxx-xxxx-xxx',
    },
  },
})
this.dbx.subscribe('ida', () => {
  // this function will be called when componentB use .get to request data and get new data
})
```

In componentB:

```js
this.dbx.register({
  id: 'idb',
  url: 'aaa',
  options: {
    headers: {
      'Auth-Token': 'xxxx-xxxx-xxx',
    },
  },
})
this.dbx.get('idb')
```

Although the id of componentA's databaxe is 'ida', it will be notified becuase of same url+options.

**Why do we need shared datasource?**

Shared datasource help us to keep only one block of data amoung same datasources.

Different component is possible to call same data source more than once in a short time,
DataBaxe will help you to merge these requests, only once request happens.

## transform

Use transform functions to convert output data to your imagine construct.
Each transform function recieve a parameter `data` so you can modify it:

```js
let transform = data => {
  let results = data.map((item, i) => {
    if (i === 0) {
      return Object.assign({}, item, { first: true })
    }
    return item
  })
  return data
}
this.dbx.register({
  id: 'myid',
  url: 'xxx',
  transform,
})
```

The return value will be used in following program when get:

```js
let data = await this.dbx.get('myid') // here `data` is transformed.
```

Transform functions should be pure function whit certain input and output.
You should must not change original data in transform functions.

## Contribute

You're wellcome to contribute to this library.
If you are interested in this library, you can submit any issue.

## MIT License

Copyright 2018 tangshuang

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
