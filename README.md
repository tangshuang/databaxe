DataBaxe
========

A modern data request and store tool for frontend.

## Install

```
npm install databaxe --save
```

## Usage

ES6:

```
import DataBaxe from 'databaxe/src/databaxe'
```

CommonJS:

```
const DataBaxe from 'databaxe'
```

Browser:

```
<script src="node_modules/databaxe/dist/databaxe.bundle.js"></script>
<script>
// window.DataBaxe
</script>
```

## Construct

```
const dbx = new DataBaxe(settings, options)
```

**settings**

It will be merged with `DataBaxe.defaultSettings`.

- debug: false, whether to show debug information.
- expires: 0, expires time, 1ms

Change `DataBaxe.snapshotsMaxCount` to set default snapshots max count.

**options**

It will be merge with `DataBaxe.defaultOptions`, and used as default ajax request options.
DataBaxe use axios to request data, if you want to learn more, read [here](https://github.com/axios/axios).

- baseURL: '',
- method: 'get',

```
export default class MyComponent {
  constructor() {
    // step 1: initialize a instance
    this.dbx = new DataBaxe()

    // step 2: register datasources
    this.dbx.register({
      id: 'myid',
      url: '/users/{id}',
      expires: 60*1000, // 1 min
    })

    // step 3: subscribe change callbacks
    this.dbx.subscribe('myid', (data, params) => { 
      // params is what you passed when you call .get(id, params) or .request(id, params)
      // you can use params to determine whether to go on,
      // for example:
      if (params.id === '111') {
        this.render()
      }
    })
    
    this.render()
  }
  async render() {
    // step 4: use data from datamanager
    let data = await this.dbx.get('myid', { id: '111' })
    
    // now, use data to render
    // ...
  }
}
```

## Methods

### register(datasources)

Register datasources in datamanager, notice, data is shared with other components which use datamanager, however, transformers are not shared.

It is ok if you pass only one datasource here.

**datasource**

_object_

```
{
  id: '', // string, identifation of this datasource, can be only called by current instance
  url: '', // string, url to request data, 
    // you can use interpolations in it, i.e. 'https://xxx/{user_name}/{id}', 
    // and when you cal `.get` method, you can pass params in the second parameter,
    // if you pass relative url, it will be connected with options.host
  transformers: [() => {}], // [function], transform your data before getting data from data manager, 
    // you should pass a bound function or an arrow function if you use `this` in it. 
    // transformer functions should be pure functions!!!
  expires: 10*1000, // number, 1ms
  options: {}, // axios options
}
```

When you `.get` or `.save` data, this datasource info will be used as basic information. 
However `options` which is passed to .get and .save will be merged into this information, and the final request information is a merged object.

### subscribe(id, callback, priority = 10)

Add a callback function in to callback list.
Notice, when data changed (new data requested from server side), all callback functions from components will be called.

**id**

Datasource id.

**callback(data, params, options)**

Callback function when request successfully from backend data api, and new data is put into database.

- data: new data from api
- params: interpolations for url
- options: axios options, options.method should not be 'put', 'delete', 'patch'

```
dbx.subscribe('myid', (data) => {
  console.log(data)
})
```

With `params` and `options`:

```
dbx.subscribe('myid', (data, params, options) => {
  if (params.userId === 112 && options.data && options.data.taskId === 'xxx') {
    console.log(data)
  }
})

dbx.get('myid', { userId: 112 }, { method: 'post', data: { taskId: 'xxx' } })
``` 

Why it is so complex? Because a datasource may have url interpolations, or have different request options. 
Different request should have different response plan.

**priority**

The order of callback functions to run, the bigger ones come first. Default is 10.

### unsubscribe(id, callback)

Remove corresponding callback, so do not use anonymous functions as possible.

If callback is 'undefined', all callbacks of this datasource will be removed.

You must to do this before you destroy your component, or you will face memory problem.

### dispatch(id, params, options, data)

_DO NOT USE THIS METHOD IF YOU DO NOT SURE WHAT IT WILL DO._

Save data to database to replace old data.
Call all callback functions which are appended to this data source's callback list.
You SHOULD notice that, not only this DataBaxe intance's callbacks, but also all callbacks of others will be triggered.

### get(id, params, options, force)

Get data from database and return a Promise instance. If data is not exists, it will request data from server side.
Don't be worry about several calls. If in a page has several components request a url at the same time, only one request will be sent, and all of them will get the same Promise instance and will be notified by subscribed callback functions.

When the data is back from server side, all component will be notified.

If `expires` is set, data in database will be used if not expired, if the data is expired, it will request again which cost time (which will trigger callback).

If not set, data in local database will always be used if exist, so it is recommended to set a `expires` time.

If there is data in database, and expired, and request fail, local database data will be used again. A warn message will be throw out in console if `debug` is true.

*Notice: you do not get the latest data request from server side, you just get latest data from local database.*

**params**

To replace interpolations in `url` option. For example, your data source url is 'https://xxx/{user}/{no}', you can do like this:

```
async function() {
  let data = await dbx.get('myid', { user: 'lily', no: '1' })
}
```

`params` is required. If there is no params, set `{}` instead.

**options**

Request options which will be used by _axios_, if you want to use 'post' method, do like this:

```
dbx.get('myid', {}, { method: 'post', data: { key: 'value' } }).then((data) => {
  ...
})
```

But it is not as good as I wanted, you should put these information into data source:

```
dbx.register({
  id: 'myid',
  url: 'xxx',
  options: {
    method: 'post',
    data: { key: 'value' },
  },
})
dbx.get('myid').then((data) => {
  // ...
})
```

`options` is required. Set `{}` if you do not have options.

**force**

Boolean. Wether to request data directly from server side, without using local cache:

```
dbx.save('myid', {}, myData).then(async () => {
  let data = await dbx.get('myid', {}, {}, true)
})
```

Notice: when you forcely request, subscribers will be fired after data come back, and local database will be update too. So it is a good way to use force request when you want to refresh local cached data.

### save(id, params, data, options)

To save data to server side, I provide a save method. You can use it like put/post operation:

```
dbx.save('myId', { userId: '1233' }, { name: 'lily', age: 10 })
```

Notice: save method will not update the local database data. If you want to update data in database, use `get` with `force=true`.

**id**

datasource id.

**params**

Interpolations replacements variables.

**data**

post data.

**options**

Axios config.

**@return**

This method will return a promise which resolve `Response`, so you can use `then` or `catch` to do something when request is done.

`.save` method has some rules:

1. options.data will not work
2. when options.method=delete no data will be post
3. several save requests will be merged

We use a simple transaction to forbide save request being sent twice/several times in a short time. If more than one saving request happens in *10ms*, they will be merged, post data will be merged, and the final request send merged data to server side. So if one property of post data is same from two saving request, the behind data property will be used, you should be careful about this.
If you know react's `setState`, you may know more about this transaction.

In fact, a datasource which follow RestFul Api principle, the same `id` of a datasource can be used by `.get` and `.save` methods:

```
dbx.register({
  id: 'myrestapi',
  ...
})
...
let data = await dbx.get('myrestapi')

...
dbx.save('myrestapi', {}, { ...myPostData }) // here method:'POST' is important in this case
.then((res) => {
  // you can use `res` to do some logic
})
```

If you donot set options.method, it will use 'post' as default in `save` method.

### autorun(funcs)

Look back to the beginning code, step 3. 
I use subscribe to add a listener and use `if (params.id === '111')` to judge wether to run the function. 
After step 3, I call `this.render()` in callback function.
This operation makes me unhappy. Why not more easy?

Now you can use `autorun` to simplify it:

```
export default class MyComponent {
  constructor() {
    this.dbx = new DataBaxe()
    this.dbx.register({
      id: 'myid',
      url: 'http://xxx/{id}',
      transformers: [data => data],
      expires: 60*1000, // 1 min
    })

    this.autorun(this.render.bind(this))
    // yes! That's all!
    // you do not need to call `this.render()` again, autorun will run the function once at the first time constructor run.
    // And you do not need to care about `params` any more.
  }
  render() {
    let data = this.dbx.get('myid', { id: '111' })
    // ...
  }
}
```

**funcs**

Array of functions. If you pass only one function, it is ok.

To understand how `autorun` works, you should learn about [mobx](https://github.com/mobxjs/mobx)'s autorun first.

### autofree(funcs)

Freed watchings which created by `autorun`. You must to do this before you destroy your component if you have called `autorun`, or you will face memory problem.

### destory()

You should destory the instance before you unmount your component.

## Shared datasource

We use indexedBD to store data in local.

When using register, you should give `url` and `options`. We can identify a datasource with url+options. If two component register datasources with same url+options, we treat they are the same datasource, they are shared, and when one component get data which fire requesting, the other one will be notified after data back.

In componentA:

```
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

```
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

Although the id of componentA's datamanager is 'ida', it will be notified becuase of same url+options.

Transformers and subscribe callbacks will not be confused, each components has its own transformers and callbacks.

**Why do we need shared datasource?**

Shared datasource help us to keep only one block of data amoung same datasources.

Different component is possible to call same data source more than once in a short time, 
DataBaxe will help you to merge these requests, only once request happens.

## transformers

We use WebWorker to run transformer function, so output data can be changed anyway.

Use transformers to convert output data to your imagine construct. Each transformer function recieve a parameter `data` so you can modify it:

```
let transform1 = data => {
  data.forEach((item, i) => item.name = i)
  return data
}
this.dbx.register({
  ...
  transformers: [ transform1 ],
  ...
})
```

The return value will be used in following program when get:

```
let data = await this.dbx.get('myid') // here `data` is transformed.
```

Transformer functions should be pure function whit certain input and output.

Transformers will be run in pipeline. the previous transformer return value will be passed into next transformer function as parameter.

## Contribute

You're wellcome to contribute to this library.
If you are interested in this library, you can submit any issue.

## MIT License

Copyright 2018 tangshuang

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

