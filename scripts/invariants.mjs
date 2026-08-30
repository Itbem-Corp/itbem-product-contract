const hostnamePattern = /^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.(?!-)[a-z0-9-]+)+$/
const environmentVariablePattern = /^[A-Z][A-Z0-9_]*$/
const workerTopicPattern = /^[a-z][a-z0-9-]{0,79}$/

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertUnique(values, value, label) {
  assert(!values.has(value), `Duplicate ${label}: ${value}`)
  values.add(value)
}

function belongsToOwnedDomain(hostname, ownedDomains) {
  return ownedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

function domainsOverlap(left, right) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

export function validateProductContract(contract) {
  assert(contract?.schemaVersion === 1 && Array.isArray(contract.products) && contract.products.length > 0,
    'Contract must declare schemaVersion 1 and at least one product')

  const codes = new Set()
  const hosts = new Set()
  const localHosts = new Set()
  const apiHosts = new Set()
  const clientIdEnvironments = new Set()
  const emailDomains = new Set()
  const workerTopics = new Set()
  const publicHosts = new Set()
  const ownedDomains = new Set()

  for (const product of contract.products) {
    const { code, identity, capabilities, modules, deployment, worker } = product
    assert(/^[a-z][a-z0-9-]*$/.test(code) && !codes.has(code), `Invalid or duplicate product code: ${code}`)
    codes.add(code)
    assert(identity?.name && identity?.productLabel && /^#[0-9a-fA-F]{6}$/.test(identity?.accent ?? ''),
      `${code} has incomplete visual identity`)
    assert(typeof capabilities?.allowsPlatformAuthority === 'boolean' &&
      typeof capabilities?.supportsEventOperations === 'boolean' &&
      typeof capabilities?.supportsAutomation === 'boolean',
      `${code} must declare boolean capabilities`)
    assert(capabilities.supportsEventOperations === (code === 'eventiapp'), 'Event operations are exclusive to eventiapp')
    assert(capabilities.supportsAutomation === (code === 'itbem'), 'Automation is exclusive to itbem')
    assert(Array.isArray(modules) && modules.includes('home'), `${code} must contain the home module`)
    assert(modules.every((module) => /^[a-z][a-z0-9-]*$/.test(module)), `${code} has an invalid module name`)
    assert(new Set(modules).size === modules.length, `${code} has duplicate modules`)
    assert(modules.includes('events') === capabilities.supportsEventOperations,
      `${code} event module must match its event-operations capability`)
    assert(modules.includes('automation') === capabilities.supportsAutomation,
      `${code} automation module must match its automation capability`)

    assert(deployment && typeof deployment === 'object', `${code} has no deployment definition`)
    assert(Array.isArray(deployment.ownedDomains) && deployment.ownedDomains.length > 0,
      `${code} must declare at least one owned domain`)
    assert(deployment.ownedDomains.every((domain) => hostnamePattern.test(domain)), `${code} has an invalid owned domain`)
    assert(new Set(deployment.ownedDomains).size === deployment.ownedDomains.length, `${code} has duplicate owned domains`)
    for (const domain of deployment.ownedDomains) {
      assert(![...ownedDomains].some((existing) => domainsOverlap(domain, existing)),
        `Owned domain overlaps another product boundary: ${domain}`)
      ownedDomains.add(domain)
    }
    assert(hostnamePattern.test(deployment.dashboardHostname ?? ''), `${code} has an invalid dashboard hostname`)
    assert(Array.isArray(deployment.dashboardHostnames) && deployment.dashboardHostnames.includes(deployment.dashboardHostname),
      `${code} primary dashboard hostname must be declared`)
    assert(deployment.dashboardHostnames.every((host) => hostnamePattern.test(host)), `${code} has an invalid dashboard hostname alias`)
    assert(new Set(deployment.dashboardHostnames).size === deployment.dashboardHostnames.length, `${code} has duplicate dashboard hostname aliases`)
    for (const host of deployment.dashboardHostnames) {
      assert(belongsToOwnedDomain(host, deployment.ownedDomains), `${code} dashboard hostname alias must belong to an owned domain`)
      assertUnique(hosts, host, 'dashboard hostname')
    }

    assert(Array.isArray(deployment.localDashboardHostnames) && deployment.localDashboardHostnames.length > 0,
      `${code} must declare local dashboard hostnames`)
    assert(deployment.localDashboardHostnames.every((host) => host === 'localhost' || host === '127.0.0.1' || hostnamePattern.test(host)),
      `${code} has an invalid local dashboard hostname`)
    assert(new Set(deployment.localDashboardHostnames).size === deployment.localDashboardHostnames.length,
      `${code} has duplicate local dashboard hostnames`)
    for (const host of deployment.localDashboardHostnames) assertUnique(localHosts, host, 'local dashboard hostname')

    assert(hostnamePattern.test(deployment.apiHostname ?? ''), `${code} has an invalid API hostname`)
    assertUnique(apiHosts, deployment.apiHostname, 'API hostname')
    assert(environmentVariablePattern.test(deployment.cognitoClientEnv ?? ''), `${code} has an invalid Cognito client environment key`)
    assertUnique(clientIdEnvironments, deployment.cognitoClientEnv, 'Cognito client environment key')
    assert(hostnamePattern.test(deployment.emailDomain ?? ''), `${code} has an invalid email domain`)
    assertUnique(emailDomains, deployment.emailDomain, 'email domain')
    assert(deployment.ownedDomains.includes(deployment.emailDomain), `${code} email domain must be an owned domain`)
    assert(belongsToOwnedDomain(deployment.dashboardHostname, deployment.ownedDomains), `${code} dashboard hostname must belong to an owned domain`)
    assert(belongsToOwnedDomain(deployment.apiHostname, deployment.ownedDomains), `${code} API hostname must belong to an owned domain`)

    const publicExperience = deployment.publicExperience
    assert(publicExperience && typeof publicExperience.enabled === 'boolean',
      `${code} must explicitly declare whether it has a public experience`)
    if (publicExperience.enabled) {
      assert(hostnamePattern.test(publicExperience.canonicalHostname ?? ''), `${code} has an invalid public canonical hostname`)
      assert(Array.isArray(publicExperience.hostnames) && publicExperience.hostnames.includes(publicExperience.canonicalHostname),
        `${code} public canonical hostname must be declared`)
      assert(new Set(publicExperience.hostnames).size === publicExperience.hostnames.length,
        `${code} has duplicate public hostname aliases`)
      assert(publicExperience.deploymentTarget === 'cloudflare-workers',
        `${code} has an unsupported public deployment target`)
      const branding = publicExperience.branding
      assert(typeof branding?.name === 'string' && branding.name.length > 0 &&
        typeof branding?.shortName === 'string' && branding.shortName.length > 0 &&
        typeof branding?.description === 'string' && branding.description.length > 0,
      `${code} public experience has incomplete branding`)
      assert(/^[a-z]{2}-[A-Z]{2}$/.test(branding?.locale ?? ''), `${code} public experience has an invalid locale`)
      assert(/^#[0-9a-fA-F]{6}$/.test(branding?.themeColor ?? '') && /^#[0-9a-fA-F]{6}$/.test(branding?.backgroundColor ?? ''),
        `${code} public experience has invalid theme colors`)
      for (const host of publicExperience.hostnames) {
        assert(hostnamePattern.test(host), `${code} has an invalid public hostname alias`)
        assert(belongsToOwnedDomain(host, deployment.ownedDomains),
          `${code} public hostname must belong to an owned domain`)
        assert(!hosts.has(host) && !apiHosts.has(host), `${code} public hostname collides with a dashboard or API hostname`)
        assertUnique(publicHosts, host, 'public hostname')
      }
    } else {
      assert(Object.keys(publicExperience).length === 1,
        `${code} disabled public experience cannot reserve hostnames or a deployment target`)
    }

    assert(workerTopicPattern.test(worker?.productionTopic ?? ''), `${code} has an invalid worker topic`)
    assertUnique(workerTopics, worker.productionTopic, 'worker topic')
  }
}

export function validateRequestContext(requestContext) {
  assert(requestContext?.schemaVersion === 1, 'Request context contract must use schemaVersion 1')
  const headerNames = Object.values(requestContext.headers ?? {})
  assert(headerNames.length === 4 && new Set(headerNames).size === headerNames.length,
    'Request context contract must declare four unique headers')
  assert(headerNames.every((header) => typeof header === 'string' && /^x-[a-z0-9-]+$/.test(header.toLowerCase())),
    'Request context headers must use the x- prefix')
  assert(requestContext.workspaceModes?.includes('organization') && requestContext.workspaceModes?.includes('platform'),
    'Request context contract must declare organization and platform modes')
  assert(requestContext.rules?.headersAreAuthorization === false, 'Request context headers must never grant authorization')
}

export function validateRuntimeMessages(runtimeMessages) {
  assert(runtimeMessages?.schemaVersion === 1, 'Runtime message contract must use schemaVersion 1')
  const mediaFixture = runtimeMessages.mediaProcessing?.sqsFixtures?.[0]?.message
  assert(mediaFixture?.target_type === 'moment' && mediaFixture.is_video === false,
    'Runtime message contract must contain an image moment SQS fixture')
  for (const key of ['moment_id', 'event_id', 'job_id', 'object_key', 'raw_s3_key', 'bucket', 'content_type']) {
    assert(mediaFixture[key], `Media SQS fixture is missing ${key}`)
  }
  const callbackFixture = runtimeMessages.mediaProcessing?.callbackFixtures?.[0]?.payload
  assert(callbackFixture?.processing_status === 'done' && callbackFixture.object_key && callbackFixture.content_url,
    'Runtime message contract must contain a terminal media callback fixture')
  const workerFixture = runtimeMessages.workerJobs?.[0]?.envelope
  assert(workerFixture?.schema_version === 2 && workerFixture.type === 'analytics.rollup',
    'Runtime message contract must contain an analytics.rollup v2 fixture')
  assert(workerFixture.payload?.event_id && workerFixture.payload?.trigger === 'analytics_read',
    'Analytics worker fixture has an invalid payload')
}
