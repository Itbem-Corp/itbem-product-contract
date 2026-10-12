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
  assert.throws(() => validateProductContract(contract), /API hostname must belong to an owned domain/)
})

test('rejects duplicate modules and Cognito client keys', () => {
  const duplicateModule = clone(readJson('../contract/products.v1.json'))
  duplicateModule.products[0].modules.push('home')
  assert.throws(() => validateProductContract(duplicateModule), /duplicate modules/)

  const duplicateClientKey = clone(readJson('../contract/products.v1.json'))
  duplicateClientKey.products[1].deployment.cognitoClientEnv = duplicateClientKey.products[0].deployment.cognitoClientEnv
  assert.throws(() => validateProductContract(duplicateClientKey), /Duplicate Cognito client environment key/)
})

test('rejects overlapping root and delegated product domains', () => {
  const contract = clone(readJson('../contract/products.v1.json'))
  contract.products[2].deployment.ownedDomains = ['shop.eventiapp.com.mx']
  assert.throws(() => validateProductContract(contract), /Owned domain overlaps another product boundary/)
})

test('rejects ambiguous public surfaces and capability drift', () => {
  const duplicatePublicHost = clone(readJson('../contract/products.v1.json'))
  duplicatePublicHost.products[1].deployment.publicExperience = {
    enabled: true,
    canonicalHostname: 'www.eventiapp.com.mx',
    hostnames: ['www.eventiapp.com.mx'],
    deploymentTarget: 'cloudflare-workers',
    branding: structuredClone(duplicatePublicHost.products[0].deployment.publicExperience.branding)
  }
  assert.throws(() => validateProductContract(duplicatePublicHost), /owned domain|Duplicate public hostname/)

  const disabledWithHostname = clone(readJson('../contract/products.v1.json'))
  disabledWithHostname.products[1].deployment.publicExperience.canonicalHostname = 'www.itbem.com.mx'
  assert.throws(() => validateProductContract(disabledWithHostname), /disabled public experience/)

  const capabilityDrift = clone(readJson('../contract/products.v1.json'))
  capabilityDrift.products[2].modules.push('automation')
  assert.throws(() => validateProductContract(capabilityDrift), /automation module/)

  const invalidBrand = clone(readJson('../contract/products.v1.json'))
  invalidBrand.products[0].deployment.publicExperience.branding.themeColor = 'pink'
  assert.throws(() => validateProductContract(invalidBrand), /invalid theme colors/)
})

test('declares organization mode without an organization id as the caller-access scope', () => {
  const { rules } = readJson('../contract/request-context.v1.json')
  assert.equal(rules.organizationRequiresOrganizationId, false)
  assert.equal(rules.organizationWithoutIdScope, 'caller-access')
  assert.equal(rules.platformForbidsOrganizationId, true)
  assert.equal(rules.headersAreAuthorization, false)
})

test('rejects request-context headers that would grant authorization', () => {
  const contract = clone(readJson('../contract/request-context.v1.json'))
  contract.rules.headersAreAuthorization = true
  assert.throws(() => validateRequestContext(contract), /headers must never grant authorization/)
})

test('rejects a platform workspace that accepts an organization id', () => {
  const contract = clone(readJson('../contract/request-context.v1.json'))
  contract.rules.platformForbidsOrganizationId = false
  assert.throws(() => validateRequestContext(contract), /Platform workspace must forbid an organization id/)

  delete contract.rules.platformForbidsOrganizationId
  assert.throws(() => validateRequestContext(contract), /Platform workspace must forbid an organization id/)
})

test('rejects an organization workspace without an id that has no declared scope', () => {
  const missingScope = clone(readJson('../contract/request-context.v1.json'))
  missingScope.rules.organizationRequiresOrganizationId = false
  delete missingScope.rules.organizationWithoutIdScope
  assert.throws(() => validateRequestContext(missingScope), /must declare organizationWithoutIdScope/)

  const unknownScope = clone(readJson('../contract/request-context.v1.json'))
  unknownScope.rules.organizationWithoutIdScope = 'all-organizations'
  assert.throws(() => validateRequestContext(unknownScope), /Unknown organizationWithoutIdScope: all-organizations/)

  const ambiguousRequirement = clone(readJson('../contract/request-context.v1.json'))
  delete ambiguousRequirement.rules.organizationRequiresOrganizationId
  assert.throws(() => validateRequestContext(ambiguousRequirement), /organizationRequiresOrganizationId must be a boolean/)
})

test('rejects a scope for organization requests that always carry an id', () => {
  const contract = clone(readJson('../contract/request-context.v1.json'))
  contract.rules.organizationRequiresOrganizationId = true
  assert.throws(() => validateRequestContext(contract), /cannot declare organizationWithoutIdScope/)

  delete contract.rules.organizationWithoutIdScope
  validateRequestContext(contract)
})
