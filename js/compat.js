(function applyCompatibility(global) {
  'use strict';

  if (typeof global.Object.hasOwn !== 'function') {
    global.Object.hasOwn = function hasOwn(object, property) {
      return global.Object.prototype.hasOwnProperty.call(global.Object(object), property);
    };
  }
})(window);
