import interpolate from 'interpolate'
import { getObjectHashcode } from 'object-hashcode'
import HelloWorker from 'hello-worker'
import { isEqual, merge, assign } from './utils'
import { asyncEach, asyncIterate, $async } from 'hello-async'
import { $dataDB, $snapshotsDB } from './db'
import axios from 'axios'

const $dataSources = {}
const $requestQueue = {}
const $transactions = {}

export default class DataBaxe {
  static snapshotsMaxCount = 10
  static defaultSettings = {
    debug: false,
    expires: 0,
  }
  static defaultOptions = {
    baseURL: '',
    method: 'get',
  }

  constructor(settings, options) {
    this.dataSources = {}
    this.id = (settings.id || 'databaxe.' + Date.now())  + '.' + parseInt(Math.random() * 10000)
    this.settings = assign({}, DataBaxe.defaultSettings, settings)
    this.options = merge({}, DataBaxe.defaultOptions, options)
    this._deps = []
  }
  async register(dataSources) {
    // a data source object or an array are both allowed
    if (!Array.isArray(dataSources)) {
      dataSources = [dataSources]
    }

    dataSources.forEach((dataSource) => {
      let { id, url, options, transformers, expires } = dataSource
      let { method, headers, baseURL, params, data, auth } = merge({}, this.options, options)

      let _url = url.indexOf('http://') === 0 || url.indexOf('https://') === 0 ? url : baseURL ? baseURL + url : url
      let _options = {}
      if (method) {
        _options.method = method
      }
      if (headers) {
        _options.headers = headers
      }
      if (params) {
        _options.params = params
      }
      if (data) {
        _options.data = data
      }
      if (auth) {
        _options.auth = auth
      }

      let source = {
        url: _url,
        options: _options,
      }
      let hash = getObjectHashcode(source)

      if (!$dataSources[hash]) {
        $dataSources[hash] = assign({}, source, { callbacks: [] })
      }

      transformers = (transformers||[]).map(transformer => new HelloWorker(transformer))
      expires = expires || this.settings.expires
      this.dataSources[id] = assign({}, source, { hash, transformers, expires })
    })
  }
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
  }
  async unsubscribe(id, callback) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('data source ' + id + ' is not exists.')
    }

    let $source = $dataSources[dataSource.hash]
    let callbacks = $source.callbacks

    $source.callbacks = callbacks.filter((item) => {
      if (item.context === this.id) {
        if (callback === undefined) {
          return false
        }
        if (item.callback === callback) {
          return false
        }
      }
      return true
    })
  }
  async dispatch(id, params, options, data) {
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
    
    let $source = $dataSources[dataSource.hash]
    let callbacks = $source.callbacks
    
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

    await this._putData(requestId, data)
    await asyncEach(callbacks, async (item) => {
      let data = await this._getData(requestId)
      let callback = $async(item.callback)
      return await callback(data, params, options)
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
  async get(id, params = {}, options = {}, force = false) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('dataSource ' + id + ' is not exists.')
    }

    let _url = interpolate(dataSource.url, params)
    let _options = merge({}, dataSource.options, options)

    // put, delete, patch is not allowed when use `get`
    if (['put', 'delete', 'patch'].indexOf(_options.method.toLowerCase())) {
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
      let result = data
      await asyncIterate(dataSource.transformers, async (transformer, i, next) => {
        result = await transformer.invoke(result)
        next()
      })
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

    // if expires is not set, it means user want to use current cached data any way
    // when data cache is not expired, use it
    if (dataSource.expires && item.time + dataSource.expires < Date.now()) {
      try {
        let result = await request()
        return result
      }
      // if request fail, return data from database, even though the data is not the latest.
      catch(e) {
        this.debug('warn', 'Local data will be used.', e)
      }
    }
    
    let output = await transfer(item.data)
    return output
  }
  async _getData(requestId) {
    return await $dataDB.get(requestId)
  }
  async _putData(requestId, data) {
    let time = Date.now()
    let item = {
      requestId,
      time,
      data,
    }

    let snapshotsMaxCount = DataBaxe.snapshotsMaxCount
    let existsData = await $dataDB.get(requestId)
    if (existsData) {
      await $snapshotsDB.put(existsData)
      if (snapshotsMaxCount) {
        let snapshots = await $snapshotsDB.query('requestId', requestId)
        if (snapshots.length > snapshotsMaxCount) {
          let oldestSnapshot = snapshots[0]
          await $snapshotsDB.delete(oldestSnapshot.id)
        }
      }
    }

    await $dataDB.put(item)
  }
  async save(id, params = {}, data = {}, options = {}) {
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
    
    // method should not be get in `save`
    _options.method = _options.method && _options.method.toLowerCase() !== 'get' ? _options.method : 'post'

    // options.data is not allowed when 'delete'
    if (_options.method.toLowerCase() === 'delete') {
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

  async autorun(funcs) {
    if (!Array.isArray(funcs) && typeof funcs === 'function') {
      funcs = [funcs]
    }
    funcs.forEach((fun) => {
      this._wrapDep(fun)
    })
  }
  async autofree(funcs) {
    if (!Array.isArray(funcs) && typeof funcs === 'function') {
      funcs = [funcs]
    }
    funcs.forEach(fun => {
      let deps = this._deps.filter(item => item.target === fun)
      deps.forEach((dep) => {
        this.unsubscribe(dep.id, dep.callback)
      })
      this._deps = this._deps.filter(item => item.target !== fun)
    })
  }

  async destory() {
    let ids = Object.keys(this.dataSources)
    await asyncEach(ids, async (id) => {
      await this.unsubscribe(id)
    })
    this.dataSources = null
    this.settings = null
    this._deps = null
    this._dep = null
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
