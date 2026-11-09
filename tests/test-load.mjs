// Executes the shipped client.js inside a stub loader, with a fake React, so a
// top-level runtime error (a symbol removed from one place but still touched at
// module scope, a broken template literal, a bad destructure) fails HERE rather
// than in the user's panel. node --check only proves syntax.
import fs from 'node:fs'
import vm from 'node:vm'
import { readPlugin } from './plugin-source.mjs'

const src = readPlugin('client.js')

let pass = 0
let fail = 0
const ok = (cond, label, detail) => {
  if (cond) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`)
  }
}

// ── Minimal React / ReactDOM stand-ins ───────────────────────────────────────
// Enough for module-scope work: hooks are only called during render, which does
// not happen here, but the module does call createElement() to build icon
// definitions at load time — so that has to behave.
let hookCall = null
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol.for('react.fragment'),
  useState: v => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useMemo: fn => fn(),
  useRef: v => ({ current: v }),
  useCallback: fn => fn,
  useSyncExternalStore: (sub, get) => get(),
  // The module declares `class ... extends React.Component` at top level, so
  // this must be a real constructor.
  Component: class {
    constructor(props) {
      this.props = props
    }
    setState() {}
    forceUpdate() {}
  }
}
const reactDom = { createPortal: (el, node) => el }

// ── Loader shim ──────────────────────────────────────────────────────────────
const loaded = []
const sandbox = {
  window: {},
  document: undefined,
  console: { log() {}, warn() {}, error() {}, info() {} },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  fetch: async () => {
    throw new Error('network disabled in test')
  },
  CustomEvent: class {
    constructor(type, init) {
      this.type = type
      Object.assign(this, init)
    }
  },
  localStorage: {
    getItem: () => null,
    setItem() {},
    removeItem() {}
  },
  navigator: { language: 'zh-CN', languages: ['zh-CN'] },
  location: { href: 'http://127.0.0.1/' }
}
sandbox.window = sandbox
sandbox.window.__ModuleLoader__ = {
  load({ id, factory }) {
    loaded.push(id)
    const require = name => {
      if (name === 'react') return react
      if (name === 'react-dom') return reactDom
      throw new Error(`unexpected require('${name}') from ${id}`)
    }
    const result = factory(require)
    sandbox.__exports = result
    return result
  }
}

console.log('\n== module evaluates in a loader, with a stub React ==')
let threw = null
try {
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'client.js' })
} catch (e) {
  threw = e
}
ok(threw === null, 'client.js runs without throwing at load time', threw && `${threw.name}: ${threw.message}`)
ok(loaded.length === 1 && loaded[0] === 'dsh-model-master', `registers under id dsh-model-master (got ${JSON.stringify(loaded)})`)

const exportsObj = sandbox.__exports || {}
console.log('\n== the bundle still exports what the host mounts ==')
ok(typeof exportsObj.apply === 'function', 'exports.apply is a function')
ok(typeof exportsObj.inject === 'string' || Array.isArray(exportsObj.inject), 'exports.inject is declared')
ok(exportsObj.name === 'dsh-model-master', 'exports.name is dsh-model-master')
{
  const inject = exportsObj.inject
  const list = Array.isArray(inject) ? inject : [inject]
  const expected = ['slots', 'sessions', 'remote', 'remote.session', 'modelDirectories']
  ok(
    expected.every(s => list.includes(s)),
    `inject still requests ${expected.join(', ')}`,
    `got ${JSON.stringify(list)}`
  )
}

console.log('\n== a stub apply() does not explode on a bare context ==')
{
  // apply() does real work (dock roots, slots), so it is expected to throw on a
  // hollow ctx. What matters is *how*: a ReferenceError or TypeError about a
  // missing identifier means we deleted something still in use. A complaint
  // about the missing service/api means the wiring is intact.
  let err = null
  try {
    exportsObj.apply({
      effect() {},
      get() {
        return undefined
      },
      on() {
        return () => {}
      },
      logger: { info() {}, warn() {}, error() {}, debug() {} }
    })
  } catch (e) {
    err = e
  }
  const msg = err ? `${err.name}: ${err.message}` : ''
  console.log(`         (apply threw: ${msg || 'nothing'})`)
  ok(
    !/is not defined|Cannot read properties of undefined \(reading '.*'\)$/.test(msg) || !err,
    'apply() did not hit a dangling identifier',
    msg
  )
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
