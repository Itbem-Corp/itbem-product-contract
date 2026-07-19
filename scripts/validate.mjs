import { loadContract } from './contract.mjs'
import fs from 'node:fs'

const contract = loadContract()
if (contract.schemaVersion !== 1 || !Array.isArray(contract.products) || contract.products.length === 0) {
  throw new Error('Contract must declare schemaVersion 1 and at least one product')
}

const codes = new Set()
const hosts = new Set()
const localHosts = new Set()
const apiHosts = new Set()
const workerTopics = new Set()
for (const product of contract.products) {
  const { code, identity, capabilities, modules, deployment, worker } = product
  if (!/^[a-z][a-z0-9-]*$/.test(code) || codes.has(code)) throw new Error(`Invalid or duplicate product code: ${code}`)
  codes.add(code)
  if (!identity?.name || !identity?.productLabel || !/^#[0-9a-fA-F]{6}$/.test(identity?.accent ?? '')) {
    throw new Error(`${code} has incomplete visual identity`)
  }
  if (!Array.isArray(modules) || !modules.includes('home')) throw new Error(`${code} must contain the home module`)
  if (capabilities?.supportsEventOperations !== (code === 'eventiapp')) {
    throw new Error('Event operations are exclusive to eventiapp')
  }
  if (!deployment?.dashboardHostnames?.includes(deployment.dashboardHostname)) {
    throw new Error(`${code} primary dashboard hostname must be declared`)
  }
  for (const host of deployment.dashboardHostnames ?? []) {
    if (hosts.has(host)) throw new Error(`Duplicate dashboard hostname: ${host}`)
    hosts.add(host)
  }
  for (const host of deployment.localDashboardHostnames ?? []) {
    if (localHosts.has(host)) throw new Error(`Duplicate local dashboard hostname: ${host}`)
    localHosts.add(host)
  }
  if (apiHosts.has(deployment.apiHostname)) throw new Error(`Duplicate API hostname: ${deployment.apiHostname}`)
  apiHosts.add(deployment.apiHostname)
  if (workerTopics.has(worker?.productionTopic)) throw new Error(`Duplicate worker topic: ${worker?.productionTopic}`)
  workerTopics.add(worker?.productionTopic)
}

const requestContext = JSON.parse(fs.readFileSync(new URL('../contract/request-context.v1.json', import.meta.url), 'utf8'))
if (requestContext.schemaVersion !== 1) throw new Error('Request context contract must use schemaVersion 1')
const headerNames = Object.values(requestContext.headers ?? {})
if (headerNames.length !== 4 || new Set(headerNames).size !== headerNames.length) {
  throw new Error('Request context contract must declare four unique headers')
}
if (!requestContext.workspaceModes?.includes('organization') || !requestContext.workspaceModes?.includes('platform')) {
  throw new Error('Request context contract must declare organization and platform modes')
}
if (requestContext.rules?.headersAreAuthorization !== false) {
  throw new Error('Request context headers must never grant authorization')
}
