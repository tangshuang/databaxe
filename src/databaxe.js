import interpolate from 'interpolate'
import { getObjectHashcode } from 'object-hashcode'
import { isEqual, merge, assign } from './utils'
import { asyncE, asyncM, $async } from 'hello-async'
import axios from 'axios'
import HelloStorage from 'hello-storage'

const $dataSources = {}
const $requestQueue = {}
const $transactions = {}

export class DataBaxe {
  static defaultSettings = {
    debug: false,
    expire: 0,
    baseURL: '', // backend url base
    storage: null, // storage for hello-storage
    options: {}, // default options for axios
  }

  constructor(settings) {
    this.dataSources = {}
    this.id = (settings.id || 'databaxe.' + Date.now())  + '.' + parseInt(Math.random() * 10000, 10)
    this.settings = assign({}, DataBaxe.defaultSettings, settings)
    this._deps = []

    this.storage = new HelloStorage({
      namespace: 'databaxe',
      storage: this.settings.storage,
    })
  }

  /**
   * add data source into databaxe,
   * dataSources can be an array or an object,
   * the object strcuture:
   *
   * {
   *   // id should be unique in this instance, it will be used by `get`
   *   id: 'book',
   *   // url can contain interpolation, it will be replaced by params of `get`
   *   url: '/api/v2/books/{id}',
   *   // options will be passed into axios
   *   options: {
   *     method: 'GET',
   *     headers: {
   *       'Access-Token': window.authtoken,
   *     },
   *   },
   *   // transform is a function to convert response data, the output will be the final data of `get`
   *   // data in storage is always the original data
   *   transform: function(data) {
   *     return data
   *   },
   * }
   *
   * @param {*} dataSources
   */
  async register(dataSources) {
    // a data source object or an array are both allowed
    if (!Array.isArray(dataSources)) {
      dataSources = [dataSources]
    }

    await asyncM(dataSources, (dataSource) => {
      let { id, url, options, transform } = dataSource
      let { baseURL } = this.settings
      let expire = dataSource.expire || this.settings.expire

      url = url.indexOf('http://') === 0 || url.indexOf('https://') === 0 ? url : baseURL ? baseURL + url : url
      options = merge({}, this.settings.options, options)

      let source = { url, options }
      let hash = getObjectHashcode(source)

      if (!$dataSources[hash]) {
        $dataSources[hash] = assign({}, source, { callbacks: [] })
      }

      this.dataSources[id] = assign({}, source, { hash, transform, expire })
    })
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
   * @param {*} callback a function which receive (data, options, params) which passed by `get`
   * @param {*} priority
   */
  async subscribe(id, callback, priority = 10) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('data source ' + id + ' is not exists.')
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
   * @param {*} options options which is used to get the data
   * @param {*} params params which is used to get the data
   */
  async dispatch(id, data, options = {}, params = {}) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('data source ' + id + ' is not exists.')
    }

    let _url = interpolate(dataSource.url, params)
    let _options = merge({}, dataSource.options, options)
    let requestId = getObjectHashcode({
      url: _url,
      options: _options,
    })
    await this._putData(requestId, data)

    let $source = $dataSources[dataSource.hash]
    let callbacks = $source.callbacks
    await asyncE(callbacks, async (item) => {
      let data = await this._getData(requestId)
      let callback = $async(item.callback)
      return await callback(data, options, params)
    })
  }

  _wrapDep(fun) {
    this._dep = {
      target: fun,
    }
    fun()
    delete this._dep
  }
  _addDep() {
    let dep = this._dep

    if (this._deps.find(item => item.id === dep.id && isEqual(item.params, dep.params) && isEqual(item.options, dep.options) && item.target === dep.target)) {
      return false
    }

    let callback = (data, params, options) => {
      if (isEqual(dep.params, params) && isEqual(dep.options, options)) {
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
   * @param {*} params params to interpolate into url
   * @param {*} force whether to ignore existed data, if true, local data will be updated after new data back
   */
  async get(id, options = {}, params = {}, force = false) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('dataSource ' + id + ' is not exists.')
    }

    let _url = interpolate(dataSource.url, params)
    let _options = merge({}, dataSource.options, options)

    if (['put', 'delete', 'patch'].indexOf(_options.method.toLowerCase()) > -1) {
      throw new Error(_options.method + ' is not allowed when you get data.')
    }

    // delete options.data when use 'get' method
    if (_options.method.toLowerCase() === 'get') {
      delete _options.data
    }

    // add dependences
    if (this._dep && this._dep.target) {
      this._dep.id = id
      this._dep.params = params
      this._dep.options = options
      this._addDep()
    }

    let requestId = getObjectHashcode({
      url: _url,
      options: _options,
    })

    const transfer = async (data) => {
      let result = await $async(transform)(data)
      return result
    }
    const request = () => {
      if ($requestQueue[requestId]) {
        return $requestQueue[requestId]
      }
      $requestQueue[requestId] = axios(_url, _options).then((res) => {
        $requestQueue[requestId] = null
        return res.data
      }).then((data) => {
        return this.dispatch(id, params, options, data).then(() => data)
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

    let item = await this._getData(requestId)
    if (!item) {
      let result = await request()
      return result
    }

    // if expire is not set, it means user want to use current cached data any way
    // when data cache is not expired, use it
    if (dataSource.expire && item.time + dataSource.expire < Date.now()) {
      try {
        let result = await request()
        return result
      }
      // if request fail, return data from databaxe, even though the data is not the latest.
      catch(e) {
        this.debug('warn', 'Local data will be used.', e)
      }
    }

    let output = await transfer(item.data)
    return output
  }

  async _getData(requestId) {
    return await this.storage.get(requestId)
  }
  async _putData(requestId, data) {
    await this.storage.set(requestId, data)
  }

  /**
   * save data to backend,
   * notice that, if the same data source id is saved in a short time, post data will be merged, and only one ajax will be send.
   *
   * @param {*} id data source id
   * @param {*} data post data
   * @param {*} options axios configs
   * @param {*} params params to interpolate into url
   */
  async save(id, data = {}, options = {}, params = {}) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('dataSource ' + id + ' is not exists.')
    }

    // option.data is disabled
    if (options.data) {
      delete options.data
    }

    let _url = interpolate(dataSource.url, params)
    let _options = merge({}, dataSource.options, options)

    // method should not be 'get' in `save`
    if (!_options.method || _options.method.toLowerCase() === 'get') {
      throw new Error(`'get' method is not allowed when save data to backend.`)
    }

    // options.data is not allowed when 'delete'
    if (['post', 'put', 'patch'].indexOf(_options.method.toLowerCase()) === -1) {
      delete _options.data
    }

    let requestId = getObjectHashcode({
      url: _url,
      options: _options,
    })

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
    }, 10)

    if (tx.processing) {
      return tx.processing
    }

    const request = async () => {
      await Promise.all(tx.promises)
      return await axios(_url, merge({}, _options, { data: tx.data }))
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
      const level = args[0]
      const isInvoke = typeof console[level] === 'function'

      if (!isInvoke) {
        console.trace(id, ...args)
        return
      }

      console[level](id, ...args)
    }
  }

}

export default DataBaxe
