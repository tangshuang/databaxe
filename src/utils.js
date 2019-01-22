export function isEqual(obj1, obj2) {
  if (!isObject(obj1) || !isObject(obj2)) {
    return obj1 === obj2
  }
  if (Object.keys(obj1).length == 0 && Object.keys(obj2).length === 0) {
    return true
  }
  return obj1 === obj2
}

export function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item)
}

export function merge(target, ...sources) {
  if (!sources.length) {
    return target
  }

  const source = sources.shift()
  if (isObject(target) && isObject(source)) {
    const keys = Object.keys(source)
    keys.forEach((key) => {
      const value = source[key]
      if (isObject(value)) {
        if (!target[key] || !isObject(target[key])) {
          target[key] = {}
        }
        merge(target[key], value)
      }
      else {
        target[key] = value
      }
    })
  }

  return merge(target, ...sources)
}

export function assign(...sources) {
  return Object.assign(...sources)
}
