import merge from 'lodash.merge'
import interpolate from 'interpolate'
import { getObjectHashcode, getStringHashcode } from 'object-hashcode'
import HelloWorker from 'hello-worker'
import { isEqual } from './utils'
import { asyncSerial, asyncEach, asyncIterate, asyncFn } from 'hello-async'
import { $dataSotre, $snapshotsSotre } from './db'

const $dataSources = {}
const $requestQueue = {}
const $transactions = {}

export default class DataBaxe {
  static defaultOptions = {
    host: '',
    debug: false,
    sanpshotsMaxCount: 0,
    expires: 0,
    middlewares: [],
  }

  constructor(options) {
    this.dataSources = {}
    this.id = (options.id || 'databaxe.' + Date.now())  + '.' + parseInt(Math.random() * 10000)
    this.settings = Object.assign({}, DataTaker.defaultOptions, options)
    this.settings.middlewares = (options.middlewares||[]).concat(DataTaker.defaultOptions.middlewares)
    this._deps = []
  }
  async register(dataSources) {
    // a data source object or an array are both allowed
    if (!Array.isArray(dataSources)) {
      dataSources = [dataSources]
    }

    dataSources.forEach((dataSource) => {
      let { url, type, postData, id, transformers, middlewares, expires } = dataSource
      let { host } = this.settings
      let requestURL = url.indexOf('http://') === 0 || url.indexOf('https://') === 0 ? url : host + url
      let hash = getObjectHashcode({ type, url: requestURL, postData })
      let $source = {
        hash,
        url: requestURL,
        type,
        postData,
      }

      if (!$dataSources[hash]) {
        $dataSources[hash] = Object.assign({}, $source, { callbacks: [] })
      }

      transformers = (transformers||[]).map(transformer => new HelloWorker(transformer))
      expires = expires || this.settings.expires
      middlewares = (middlewares||[]).concat(this.settings.middlewares)
      this.dataSources[id] = Object.assign({}, $source, { transformers, middlewares, expires })
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

    let { url, type } = dataSource
    let requestURL = interpolate(url, params)
    let req = Object.assign({}, options)
    req.url = requestURL
    req.method = (req.method || type || 'get').toUpperCase()
    req.body = JSON.stringify(Object.assign({}, dataSource.postData, req.postData))

    let requestId = getObjectHashcode(req)
    await this._putToStore(requestId, data)

    let $source = $dataSources[dataSource.hash]
    let callbacks = $source.callbacks.filter(item => item.context === this.id)

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

    await asyncEach(callbacks, async (item) => {
      let data = await this._getData(requestId)
      await asyncFn(item.callback)(data, params, options)
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
  async get(id, params, options, force) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('dataSource ' + id + ' is not exists.')
    }

    // add dependences
    if (this._dep && this._dep.target) {
      this._dep.id = id
      this._dep.params = params
      this._dep.options = options
      this._addDep()
    }

    let { url, type, transformers, middlewares, expires } = dataSource
    let requestURL = interpolate(url, params)
    let req = Object.assign({}, options)
    req.url = requestURL
    req.method = (req.method || type || 'get').toUpperCase()
    req.body = JSON.stringify(Object.assign({}, dataSource.postData, req.postData))

    let requestId = getObjectHashcode(req)

    if ($requestQueue[requestId]) {
      return await $requestQueue[requestId]
    }

    const transfer = async (data) => {
      let result = data
      await asyncIterate(transformers, async (transformer) => {
        result = await transformer.invoke(result)
      })
      return result
    }
    const request = async () => {
      try {
        await asyncSerial(middlewares, req, null)
        let res = await fetch(requestURL, req)
        await asyncSerial(middlewares, req, res)
        let data = res.data ? await res.data() : await res.json()
        
        $requestQueue[requestId] = null
  
        await this.dispatch(id, params, options, data)
        return await transfer(data)
      }
      catch(e) {
        $requestQueue[requestId] = null
        throw e
      }
    }
    const graph = async () => {
      $requestQueue[requestId] = request()
      return await $requestQueue[requestId]
    }

    if (force) {
      return await graph()
    }
    
    let item = await this._getData(requestId)
    if (!item) {
      return await graph()
    }

    // if expires is not set, it means user want to use current cached data any way
    // when data cache is not expired, use it
    if (expires && item.time + expires < Date.now()) {
      return await graph()
    }
    
    let output = await transfer(item.data)
    return output
  }
  async _getData(requestId) {
    return await $dataSotre.get(requestId)
  }
  async _putData(requestId, data) {
    let { sanpshotsMaxCount } = this.settings

    let time = Date.now()
    let item = {
      requestId,
      time,
      data,
    }

    let existsData = await $dataSotre.get(id)
    if (existsData) {
      await $snapshotsSotre.put(existsData)
      if (sanpshotsMaxCount) {
        let snapshots = await $snapshotsSotre.query('requestId', requestId)
        if (snapshots.length > sanpshotsMaxCount) {
          let lastSnapshot = snapshots[snapshots.length - 1]
          await $snapshotsSotre.delete(lastSnapshot.id)
        }
      }
    }

    await $dataSotre.put(item)
  }
  async save(id, params = {}, data, options = {}) {
    let dataSource = this.dataSources[id]
    if (!dataSource) {
      throw new Error('dataSource ' + id + ' is not exists.')
    }

    let { url, middlewares } = dataSource
    let type = (options.method || dataSource.type || 'post').toUpperCase()
    let requestURL = interpolate(url, params)
    let hash = getObjectHashcode({ type, url: requestURL })

    let $transaction = $transactions[hash]
    let reset = () => {
      return {
        resolves: [],
        promises: [],
        data: {},
        timer: null,
        processing: null,
      }
    }
    if (!$transaction) {
      $transaction = $transactions[hash] = reset()
    }

    let { resolves, promises, timer, processing } = $transaction
    $transaction.data = merge({}, $transaction.data, data)
    promises.push(new Promise(resolve => resolves.push(resolve)))

    if (timer) {
      clearTimeout(timer)
    }
    $transaction.timer = setTimeout(() => {
      resolves.forEach(resolve => resolve())
      $transactions[hash] = reset()
    }, 10)

    if (processing) {
      return processing
    }

    const request = async () => {
      await Promise.all(promises)

      let req = Object.assign({}, options)
      req.method = type
      req.body = JSON.stringify($transaction.data)

      $transactions[hash] = reset()

      await asyncSerial(middlewares, req, null)
      let res = await fetch(requestURL, req)
      await asyncSerial(middlewares, req, res)

      return res
    }

    $transaction.processing = request()
    return await $transaction.processing
  }

  async autorun(funcs) {
    if (!Array.isArray(funcs) && typeof funcs === 'function') {
      funcs = [ funcs ]
    }
    funcs.forEach((fun) => {
      this._wrapDep(fun)
    })
  }
  async autofree(funcs) {
    if (!Array.isArray(funcs) && typeof funcs === 'function') {
      funcs = [ funcs ]
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
      console.log(this.id, ...args)
    }
  }
}
