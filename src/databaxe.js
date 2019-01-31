import interpolate from 'interpolate'
import { getObjectHashcode } from 'object-hashcode'
import { isEqual, merge, assign, invoke, isFunction } from './utils'
import { asyncE, asyncM, $async } from 'hello-async'
import axios from 'axios'
import HelloStorage from 'hello-storage'

const $dataSources = {}
const $requestQueue = {}
const $transactions = {}

export class DataBaxe {
  static defaultSettings = {
    debug: false,
    expire: 0, // cache expire time for `get` method
    debounce: 10, // debounce time for `save` mehtod
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

  constructor(settings) {
    this.id = (settings.id || 'databaxe.' + Date.now())  + '.' + parseInt(Math.random() * 10000, 10)
    this.settings = assign({}, DataBaxe.defaultSettings, settings)
    this.storage = new HelloStorage(Object.assign({}, this.settings.store, { async: true }))

    this.dataSources = {}
    this.aliasSources = {}
    this._deps = []

    invoke(this.settings.onInit)
  }

  /**
   * add data source into databaxe,
   * dataSources can be an array or an object,
   * the object strcuture:
   *
   * {
   *   // id should be unique in this instance, it will be used by `get`
   *   id: 'book',
   *
   *   // url can contain interpolation, it will be replaced by params of `get`
   *   url: '/api/v2/books/{id}',
   *
   *   // options will be passed into axios
   *   options: {
   *     method: 'GET',
   *     headers: {
   *       'Access-Token': window.authtoken,
   *     },
   *   },
   *
   *   // transform is a function to convert response data, the output will be the final data of `get`
   *   // data in storage is always the original data
   *   transform: function(data) {
   *     return data
   *   },
   *
   *   // to hold response from backend
   *   // it is designed to check data
   *   take: function(res) {},
   * }
   *
   * @param {*} dataSources
   */
  async register(dataSources) {
    // a data source object or an array are both allowed
    if (!Array.isArray(dataSources)) {
      dataSources = [dataSources]
    }

    dataSources.forEach((dataSource) => {
      let { id, url, options, take, transform, fn, type, expire, debounce } = dataSource

      // treat as an alias action
      if (!url && fn) {
        this.alias(id, fn, type)
        invoke(this.settings.onRegister, id)
        return
      }

      options = merge({}, this.settings.options, options)

      let source = { url, options }
      let hash = getObjectHashcode(source)

      if (!$dataSources[hash]) {
        $dataSources[hash] = assign({}, source, { callbacks: [] })
      }

      expire = expire || this.settings.expire
      debounce = debounce || this.settings.debounce
      this.dataSources[id] = assign({}, source, { hash, take, transform, expire, debounce })

      invoke(this.settings.onRegister, id)
    })
  }

  /**
   * alias a id to get data,
   * it makes data management more comfortable.
   * Notice, it does not support subscribe.
   *
   * @example
   *
   * this.alias('key', function() {
   *   let [data1, data2] = Promise.all([
   *     this.get('key1'), // use `this` in fn function
   *     this.get('key2'),
   *   ])
   *   return {
   *     company: data1.company,
   *     users: data2.users,
   *   }
   * })
   *
   * let info = await this.get('key') // use the id key to get fn output
   *
   * @param {*} id
   * @param {*} fn a function to return data
   * @param {'get'|'save'} type which method to use to request
   */
  async alias(id, fn, type = 'get') {
    let dataSource = this.dataSources[id]
    if (dataSource) {
      throw new Error('data source ' + id + ' is existing.')
    }
    if (!isFunction(fn)) {
      throw new Error('data alias ' + id + ' should have fn function.')
    }
    if (['get', 'save'].indexOf(type) === -1) {
      throw new Error('data alias ' + id + ' should have type with get|save')
    }
    this.aliasSources[id] = { fn, type }
  }

  /**
   * subscribe the change of a data source stored data,
   * when a data source's true data in storage changed,
   * callback function will run.
   *
   * Notice that, data sources are shared among databaxe instances,
   * if another databaxe instance change the data of a same hash data source,
   * current databaxe instance's callback will be triggered too.
   *
   * @param {*} id the data source id
   * @param {*} callback a function which receive (data, params, options) which passed by `get`
   * @param {*} priority
   */
  async subscribe(id, callback, priority = 10) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('data source ' + id + ' is not existing.')
    }

    if (!isFunction(callback)) {
      return
    }

    let $source = $dataSources[dataSource.hash]
    let callbacks = $source.callbacks

    callbacks.push({
      context: this.id,
      callback,
      priority,
    })

    callbacks.sort((a, b) => {
      if (a.priority > b.priority) {
        return -1
      }
      else if (a.priority < b.priority) {
        return 1
      }
      else {
        return 0
      }
    })
  }

  /**
   * the reverse function of subscribe
   * @param {*} id
   * @param {*} callback
   */
  async unsubscribe(id, callback) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('data source ' + id + ' is not exists.')
    }

    let $source = $dataSources[dataSource.hash]
    let callbacks = $source.callbacks

    callbacks.forEach((item, i) => {
      if (item.context === this.id) {
        if (callback === undefined || item.callback === callback) {
          callbacks.splice(i, 1)
        }
      }
    })
  }

  /**
   * notify the change of a data source's data,
   * all callbacks will be triggered.
   *
   * Notice that, all same hash data sources' callbacks among all databaxe instances will be triggered.
   *
   * @param {*} id which data source id of this instance to trigger
   * @param {*} data the data to notice change
   * @param {*} info info which is used to get the data
   */
  async dispatch(id, data, info) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('data source ' + id + ' is not exists.')
    }

    const { url, options, originalOptions } = info
    const requestId = getObjectHashcode({ url, options })

    await this._putData(requestId, data)
    invoke(this.settings.onUpdate, id, data)
    this.debug({
      id,
      url,
      options,
      data,
    })

    let $source = $dataSources[dataSource.hash]
    let callbacks = $source.callbacks
    let cache = await this._getData(requestId)

    await asyncE(callbacks, async (item) => {
      let callback = $async(item.callback)
      return await callback(cache, originalOptions)
    })
  }

  _wrapDep(fun) {
    this._dep = { target: fun }
    fun()
    delete this._dep
  }
  _addDep() {
    let dep = this._dep

    if (this._deps.find(item => item.id === dep.id && isEqual(item.options, dep.options) && item.target === dep.target)) {
      return false
    }

    let callback = (data, options) => {
      if (isEqual(dep.options, options)) {
        this._wrapDep(dep.target)
      }
    }

    this._deps.push(dep)
    this.subscribe(dep.id, callback)

    return true
  }

  /**
   * get data from databaxe by data source id,
   * if data is not existed or expired, databaxe will send an ajax request to get data from backend first,
   * so, you will get data anyway at anytime.
   *
   * @param {*} id data source id
   * @param {*} options options for axios
   * @param {*} force whether to ignore existed data, if true, local data will be updated after new data back
   */
  async get(id, options, force = false) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      let aliasSource = this.aliasSources[id]
      if (!aliasSource) {
        throw new Error('data source ' + id + ' is not exists.')
      }

      // use alias to request
      let { fn, type } = aliasSource
      if (type !== 'get') {
        throw new Error('data alias ' + id + ' is not type of `get`.')
      }

      let result = await $async(fn)(options, force)
      return result
    }


    const _options = merge({}, dataSource.options, options)
    const _url = interpolate(dataSource.url, _options.fillers || {})
    const method = _options.method

    if (method && ['get', 'post', 'headers', 'options'].indexOf(method.toLowerCase()) === -1) {
      throw new Error('method:' + method + ' is not allowed when you get data.')
    }

    delete _options.fillers
    // delete options.data when use 'get' method
    if (!method || method.toLowerCase() !== 'post') {
      delete _options.data
    }

    // add dependences
    if (this._dep && this._dep.target) {
      this._dep.id = id
      this._dep.options = options
      this._addDep()
    }

    const requestId = getObjectHashcode({ url: _url, options: _options })

    const transfer = async (data) => {
      let transform = dataSource.transform
      if (typeof transform === 'function') {
        let result = await $async(transform)(data)
        return result
      }
      else {
        return data
      }
    }
    const request = () => {
      if ($requestQueue[requestId]) {
        return $requestQueue[requestId]
      }

      let info = { url: _url, options: _options }
      invoke(this.settings.onRequest, id, info)

      $requestQueue[requestId] = axios(info.url, info.options).then((res) => {
        $requestQueue[requestId] = null

        invoke(this.settings.onResponse, id, res)
        invoke(dataSource.take, res)

        return res.data
      }).then((data) => {
        return this.dispatch(id, data, { url: _url, options: _options, originalOptions: options }).then(() => data)
      }).then((data) => {
        return transfer(data)
      }).catch((e) => {
        $requestQueue[requestId] = null
        throw e
      })

      return $requestQueue[requestId]
    }

    if (force) {
      let result = await request()
      return result
    }

    let cache = await this._getData(requestId)

    // the first time to request data from backend
    if (!cache) {
      let result = await request()
      return result
    }

    // if expire is not set, it means user want to use current cached data any way
    // when data cache is not expired, use it
    if (dataSource.expire && cache.time + dataSource.expire < Date.now()) {
      try {
        let result = await request()
        return result
      }
      // if request fail, latest cache will be used
      catch(e) {
        this.debug(e)
      }
    }

    let result = await transfer(cache.data)
    return result
  }

  async _getData(requestId) {
    return await this.storage.get(requestId)
  }
  async _putData(requestId, data) {
    let time = Date.now()
    let cache = {
      time,
      data,
    }
    await this.storage.set(requestId, cache)
  }

  /**
   * save data to backend,
   * notice that, if the same data source id is saved in a short time, post data will be merged, and only one ajax will be send.
   * default method is 'POST' if not passed.
   *
   * @param {*} id data source id
   * @param {*} data post data
   * @param {*} options axios configs
   */
  async save(id, data, options) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      let aliasSource = this.aliasSources[id]
      if (!aliasSource) {
        throw new Error('data source ' + id + ' is not exists.')
      }

      // use alias to request
      let { fn, type } = aliasSource
      if (type !== 'save') {
        throw new Error('data source ' + id + ' is not type of `save`.')
      }

      return await $async(fn)(data, options)
    }

    let _options = merge({}, dataSource.options, options)
    let _url = interpolate(dataSource.url, _options.fillers || {})
    let method = _options.method

    if (!method) {
      method = 'POST'
      _options.method = method
    }

    // method should not be 'get' in `save`
    if (['post', 'put', 'delete', 'patch'].indexOf(method.toLowerCase()) === -1) {
      throw new Error('method:' + method + ' is not allowed when you save data.')
    }

    delete _options.fillers

    // option.data is disabled
    if (_options.data) {
      delete _options.data
    }

    // notice, this requestId ignore post data
    const requestId = getObjectHashcode({ url: _url, options: _options, data: true })

    let tx = $transactions[requestId]
    let reset = () => {
      return {
        resolves: [],
        promises: [],
        data: {},
        timer: null,
        processing: null,
      }
    }
    if (!tx) {
      tx = $transactions[requestId] = reset()
    }

    tx.data = merge({}, tx.data, data)
    tx.promises.push(new Promise(resolve => tx.resolves.push(resolve)))

    if (tx.timer) {
      clearTimeout(tx.timer)
    }
    tx.timer = setTimeout(() => {
      tx.resolves.forEach(resolve => resolve())
      $transactions[requestId] = reset()
    }, dataSource.debounce > 10 ? dataSource.debounce : 10)

    if (tx.processing) {
      return await tx.processing
    }

    const request = async () => {
      await Promise.all(tx.promises) // the key word here !!!!!!!!!!

      let __options = merge({}, _options, { data: tx.data })
      // options.data is not allowed when 'delete'
      if (['post', 'put', 'patch'].indexOf(method.toLowerCase()) === -1) {
        delete __options.data
      }

      let info = { url: _url, options: __options }
      invoke(this.settings.onRequest, id, info)

      $requestQueue[requestId] = axios(info.url, info.options).then((res) => {
        $requestQueue[requestId] = null
        $transactions[requestId] = null

        invoke(this.settings.onResponse, id, res)
        invoke(dataSource.take, res)

        return res.data
      }).catch((e) => {
        $requestQueue[requestId] = null
        $transactions[requestId] = null
        throw e
      })

      return await $requestQueue[requestId]
    }

    tx.processing = request()
    return await tx.processing
  }

  /**
   * run functions which contains `get` in them,
   * after running, you do not need to subscribe and the functions will auto run again when the reference data change.
   *
   * @example
   * async function render() {
   *   let data = dbx.get('id')
   *   renderElmentWith(data)
   * }
   * dbx.autorun(render)
   * // in the previous code, render will auto run again when data of data source 'id' change.
   *
   * @param {*} funcs
   */
  async autorun(funcs) {
    if (!Array.isArray(funcs) && typeof funcs === 'function') {
      funcs = [funcs]
    }
    await asyncM(funcs, (fun) => {
      this._wrapDep(fun)
    })
  }

  /**
   * the reverse function of `autorun`
   * @param {*} funcs
   */
  async autofree(funcs) {
    if (!Array.isArray(funcs) && typeof funcs === 'function') {
      funcs = [funcs]
    }
    await asyncM(funcs, (fun) => {
      let deps = this._deps.filter(item => item.target === fun)
      deps.forEach((dep) => {
        this.unsubscribe(dep.id, dep.callback)
      })
      this._deps = this._deps.filter(item => item.target !== fun)
    })
  }

  /**
   * destroy the databaxe intance, and release memory
   */
  async destroy() {
    let ids = Object.keys(this.dataSources)
    await asyncM(ids, async (id) => {
      await this.unsubscribe(id)
    })
    this.dataSources = null
    this.settings = null
    this._deps = null
    this._dep = null

    this.storage.clear()
    this.storage = null
  }

  debug(...args) {
    if (this.settings.debug) {
      const id = '[databaxe:' + this.id + ']'
      console.log(id, ...args)
    }
  }

}

export default DataBaxe
