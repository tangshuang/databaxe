export function isEqual(obj1, obj2) {
  if (Object.keys(obj1).length == 0 && Object.keys(obj2).length === 0) {
    return true
  }
  return obj1 === obj2
}