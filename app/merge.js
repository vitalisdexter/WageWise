(function (root, factory) {
  if (typeof module === 'object') module.exports = factory();
  else root.WageWiseMerge = factory();
})(globalThis, function () {
  'use strict';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const owns = (record, key) => record == null || !Object.hasOwn(record, key) ? undefined : record[key];
  const entries = list => Object.fromEntries((list ?? []).map((item, index) => [item.id ?? 'legacy-' + index, item]));
  const indexed = new Set(['history', 'shifts', 'bills', 'pots', 'deductionPresets']);

  function equal(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
      return left.length === right.length && left.every((item, index) => equal(item, right[index]));
    }
    if (!object(left) || !object(right) || Object.keys(left).length !== Object.keys(right).length) return false;
    return Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
  }

  function merge(base, local, remote, choices = {}) {
    const conflicts = [];
    function choose(path, left, right) {
      const key = JSON.stringify(path);
      if (!Object.hasOwn(choices, key)) conflicts.push({key, label: path.join(' › ')});
      return choices[key] === 'remote' ? right : left;
    }

    function walk(before, left, right, path) {
      if (equal(left, right)) return left;
      if (equal(before, left)) return right;
      if (equal(before, right)) return left;
      if (path[1] === 'days' && path.length === 3 && left?.status !== right?.status ||
        path.at(-2) === 'records') {
        return choose(path, left, right);
      }
      if (indexed.has(path.at(-1)) && Array.isArray(left) && Array.isArray(right)) {
        return Object.values(walk(entries(before), entries(left), entries(right), [...path, 'records']));
      }
      if (object(left) && object(right)) {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        return Object.fromEntries([...keys].map(key => [key, walk(owns(before, key), owns(left, key), owns(right, key), [...path, key])])
          .filter(([, value]) => value !== undefined));
      }
      return choose(path, left, right);
    }
    return {data: walk(base, local, remote, []), conflicts};
  }
  return {equal, merge};
});
