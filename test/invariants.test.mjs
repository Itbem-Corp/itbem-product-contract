import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateProductContract, validateRequestContext, validateRuntimeMessages } from '../scripts/invariants.mjs'

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const clone = (value) => structuredClone(value)

test('accepts the checked-in product contracts', () => {
  validateProductContract(readJson('../contract/products.v1.json'))
  validateRequestContext(readJson('../contract/request-context.v1.json'))
  validateRuntimeMessages(readJson('../contract/runtime-messages.v1.json'))
})

test('rejects a product whose endpoint escapes its email domain', () => {
  const contract = clone(readJson('../contract/products.v1.json'))
  contract.products[0].deployment.apiHostname = 'api.untrusted.example'
  assert.throws(() => validateProductContract(contract), /API hostname must belong to its email domain/)
})

test('rejects duplicate modules and Cognito client keys', () => {
  const duplicateModule = clone(readJson('../contract/products.v1.json'))
  duplicateModule.products[0].modules.push('home')
  assert.throws(() => validateProductContract(duplicateModule), /duplicate modules/)

  const duplicateClientKey = clone(readJson('../contract/products.v1.json'))
  duplicateClientKey.products[1].deployment.cognitoClientEnv = duplicateClientKey.products[0].deployment.cognitoClientEnv
  assert.throws(() => validateProductContract(duplicateClientKey), /Duplicate Cognito client environment key/)
})
