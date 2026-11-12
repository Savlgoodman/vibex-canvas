const REACT_PORTAL_TYPE = Symbol.for('react.portal');

export function createPortal(children, containerInfo, key = null) {
  return {
    $$typeof: REACT_PORTAL_TYPE,
    key: key == null ? null : String(key),
    children,
    containerInfo,
    implementation: null,
  };
}

export function flushSync(fn) {
  return typeof fn === 'function' ? fn() : undefined;
}

const api = { createPortal, flushSync };
export default api;
