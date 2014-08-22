console.log "Running Meteor tests on SauceLabs"

_         = require 'underscore'
fs        = require 'fs'
http      = require 'http'
webdriver = require 'wd'
wdSync    = require 'wd-sync'
_when     = require 'when'
parallel  = require 'when/parallel'
sequence  = require 'when/sequence'
rerun     = require 'rerun'
clc       = require 'cli-color'

httpRequestsWithoutResponse = 0
exitStatus = null
passedBrowsersCount = 0
failedBrowsersCount = 0
erroredBrowsersCount = 0
STATUS =
  PASS: 'pass'
  FAIL: 'fail'

class BrowserTestMetaData
  constructor: (run, browserCapabilities) ->
    @run = run
    @tryCount = 0
    @browserName = browserCapabilities.browserName
    @browserVersion = browserCapabilities.version
    @platform = browserCapabilities.platform

  getDescription: ->
    return "#{@browserName} #{@browserVersion} on #{@platform}"

  increaseTryCount: ->
    @tryCount++

  setStatus: (status) ->
    return if @status
    @status = status
    if @status?.status is STATUS.PASS
      passedBrowsersCount++
    else if @status?.status is STATUS.FAIL
      failedBrowsersCount++
    else
      erroredBrowsersCount++

  getTestCounts: ->
    return "Invalid test status" unless @status?.passedCount? and @status?.failedCount?
    "Number of passed tests: #{@status.passedCount}\nNumber of failed tests: #{@status.failedCount}"

  setSessionId: (sessionId) ->
    @sessionId = sessionId

  getSauceLabsLink: ->
    return "Unable to generate SauceLabs link because test did not initialize on SauceLabs." unless @sessionId
    "Details on SauceLabs: https://saucelabs.com/tests/#{@sessionId}"

  logVerbose: (message) ->
    console.log "#{@run}: #{message}"

  logLaunch: ->
    if @tryCount is 1
      console.log clc.white.bold.bgYellow "\nLaunching browser #{@getDescription()}\n"
    else
      console.log clc.white.bold.bgYellow "\nRelaunching browser #{@getDescription()} (Try #{@tryCount})\n"

  logSuccess: ->
    console.log clc.white.bold.bgGreen "\nTest passed in #{@getDescription()}\n#{@getTestCounts()}\n#{@getSauceLabsLink()}\n"

  logFailure: ->
    console.log clc.white.bold.bgRed "\nTest failed in #{@getDescription()}\n#{@getTestCounts()}\n#{@getSauceLabsLink()}\n"

  logError: (error) ->
    console.log clc.white.bold.bgRed "\nTest errored in #{@getDescription()}\nError: #{error.toString()}\n#{@getSauceLabsLink()}\n"

  logTimeout: (error) ->
    console.log clc.white.bold.bgRed "\nTest timed out in #{@getDescription()}\nRetrying..."

browsersMetaData = {}

# TODO: Output sumarry function

readJsonFile = (file_path) ->
  contents = fs.readFileSync file_path, 'utf-8'
  try
    json = JSON.parse(contents)
  catch e
    console.log "unable to parse #{file_path} as JSON:"
    console.log e
    process.exit 1
  json

unless process.env.SAUCE_USERNAME and process.env.SAUCE_ACCESS_KEY
  console.log 'SAUCE_USERNAME and SAUCE_ACCESS_KEY environment variables are required'
  process.exit 1
saucelabsCredentials =
  username: process.env.SAUCE_USERNAME
  apikey: process.env.SAUCE_ACCESS_KEY

testConfigFile = process.argv[2]
unless testConfigFile?
  console.log 'specify the saucelabs test config JSON file on the command line'
  process.exit 1
testConfig = readJsonFile testConfigFile

url = process.argv[3]
unless url?
  console.log 'specify the Meteor tinytest application URL'
  process.exit 1

_setSaucelabsTestData = (config, jobid, data, cb) ->
  body = new Buffer(JSON.stringify(data))

  httpRequestsWithoutResponse++
  req = http.request(
    {
      hostname: 'saucelabs.com'
      port: 80
      path: "/rest/v1/#{config.username}/jobs/#{jobid}"
      method: 'PUT'
      auth: config.username + ':' + config.apikey
      headers:
        'Content-length': body.length
    },
    ((res) ->
      httpRequestsWithoutResponse--
      if res.statusCode is 200
        cb(null)
      else
        cb('http status code ' + res.statusCode)
      exitIfFinished()
    )
  )

  req.on 'error', (e) ->
    cb(e)

  req.write(body)
  req.end()

setSaucelabsTestData = (sessionId, data) ->
  result = _when.defer()
  try
    _setSaucelabsTestData saucelabsCredentials, sessionId, data, (err) ->
      if err
        result.reject(err)
      else
        result.resolve()
  catch e
    result.reject(e)
  result.promise

setTestStatus = (sessionId, passed) ->
  setSaucelabsTestData sessionId, {passed}

createClient = ->
  if testConfig.where is 'local'
    wdSync.remote(testConfig.seleniumServer[0], testConfig.seleniumServer[1])
  else if testConfig.where is 'saucelabs'
    wdSync.remote(
      'ondemand.saucelabs.com',
      80,
      saucelabsCredentials.username,
      saucelabsCredentials.apikey
    )
  else
    throw new Error 'unknown where in test config: ' + testConfig.where

now = -> new Date().getTime()

poll = (timeout, interval, testFn, progressFn) ->
  give_up = now() + timeout
  loop
    ok = testFn()
    if ok?
      return ok
    else if now() > give_up
      return null
    else
      progressFn?()
      wdSync.sleep interval

# Run the tests on a single browser selected by `browserCapabilities`,
# which is an object describing which browser / version / operating system
# we want to run the tests on.
#
# See
#  http://code.google.com/p/selenium/wiki/JsonWireProtocol#Capabilities_JSON_Object
# and
#  https://saucelabs.com/docs/browsers (select node.js code)
# for descriptions of what to use in browserCapabilities.
#
# `runTestsOnBrowser` returns immediately with a promise while the
# tests run asynchronously.  The promise will be resolved when
# Meteor's test-in-browser finishes running the tests (whether the
# tests themselves pass *or* fail).  The promise will be rejected if
# there is some problem running the test: can't launch the browser,
# can't start the tests, the tests don't finish within the timeout,
# etc.

runTestsOnBrowser = (browserMetaData, browserCapabilities) ->
  done = _when.defer()

  browserMetaData.logLaunch()
  client = createClient()
  browser = client.browser
  browser.on 'status',  (info)       -> browserMetaData.logVerbose "Status: #{info}"
  browser.on 'command', (meth, path) -> browserMetaData.logVerbose "Command: #{meth} #{path}"

  capabilities = _.extend browserCapabilities,
    'max-duration': 120
    name: testConfig.name
    'tunnel-identifier': process.env.TRAVIS_JOB_NUMBER

  client.sync ->
    testStatus = null
    sessionId = null
    try
      sessionId = browser.init capabilities
      browserMetaData.setSessionId sessionId
      browser.setImplicitWaitTimeout 1000

      windowHandles = browser.windowHandles()
      if windowHandles.length isnt 1
        throw new Error('expected one window open at this point')
      mainWindowHandle = windowHandles[0]
      browserMetaData.logVerbose "mainWindowHandle #{mainWindowHandle}"

      browser.get url

      ok = poll 10000, 1000, (-> browser.hasElementByCssSelector('.header')),
        (-> browserMetaData.logVerbose 'waiting for test-in-browser\'s .header div to appear')
      throw new Error('test-in-browser .header div not found') unless ok?

      userAgent = browser.eval 'navigator.userAgent'
      browserMetaData.logVerbose "userAgent: #{userAgent}"

      meteor_runtime_config = browser.eval 'window.__meteor_runtime_config__'
      git_commit = meteor_runtime_config?.git_commit
      browserMetaData.logVerbose "git_commit: #{git_commit}" if git_commit?

      if testConfig.where is 'saucelabs'
        data = {}
        data['custom-data'] = {userAgent} if userAgent?
        data['build']       = git_commit  if git_commit?
        setSaucelabsTestData sessionId, data

      if testConfig.windowtest
        browser.elementById('begin-tests-button').click()

      browserMetaData.logVerbose 'tests are running'

      result = poll 20000, 1000, (->
        ## TODO Switching focus to another window doesn't appear to work
        ## with Opera.
        browser.window mainWindowHandle

        hasRunning = browser.hasElementByCssSelector('.running')
        hasFailed = browser.hasElementByCssSelector('.failed')
        hasPassed = browser.hasElementByCssSelector('.succeeded')
        hasPassedOnClient = _.some browser.elementsByCssSelector('.succeeded'), (element) ->
          (element.text().search 'C: ') >= 0
        hasPassedOnServer = _.some browser.elementsByCssSelector('.succeeded'), (element) ->
          (element.text().search 'S: ') >= 0

        if not hasRunning and not hasFailed and hasPassedOnClient and hasPassedOnServer
          status: STATUS.PASS
          passedCount: browser.elementsByCssSelector('.succeeded').length
          failedCount: 0
        else if not hasRunning and (hasFailed or not hasPassedOnClient or not hasPassedOnServer)
          status: STATUS.FAIL
          passedCount: browser.elementsByCssSelector('.succeeded')?.length or 0
          failedCount: browser.elementsByCssSelector('.failed')?.length or 0
        else
          null
      ), (->
        browserMetaData.logVerbose 'waiting for tests to finish'
      )

      unless result?
        throw new Error('tests did not complete within timeout')

      testStatus = result
    catch e
      browserMetaData.logVerbose e['jsonwire-error'] if e['jsonwire-error']?
      browserMetaData.logVerbose "Error: #{e}"
      # Do not continue testing if error occurs. Do not try to set status because it will fail as well.
      done.reject new rerun.RejectError e.message
      return

    try
      browser.window mainWindowHandle
      clientlog = browser.eval "$('#log').text()"
      browserMetaData.logVerbose "Clientlog #{clientlog}"
    catch e
      browserMetaData.logVerbose 'Unable to capture client log:'
      browserMetaData.logVerbose e['jsonwire-error'] if e['jsonwire-error']?
      browserMetaData.logVerbose e

    # Leave the browser open if running tests locally and the test failed.
    # (No point in leaving it open at saucelabs since it will timeout anyway).
    if testConfig.where is 'saucelabs' or testStatus
      try
        browserMetaData.logVerbose 'Shutting down the browser'
        browser.quit()
      catch e
        browserMetaData.logVerbose "Unable to quit browser #{e}"

    if testStatus
      browserMetaData.setStatus testStatus
    else
      browserMetaData.logVerbose 'Invalid test status'

    if testConfig.where is 'saucelabs'
      saucelabsTestStatus = testStatus and testStatus.status is STATUS.PASS
      browserMetaData.logVerbose 'setting test status at saucelabs', saucelabsTestStatus
      setTestStatus(sessionId, saucelabsTestStatus)
      .otherwise((reason) ->
        console.log 'failed to set test status at saucelabs:', reason
      )

    if testStatus?.status is STATUS.PASS
      browserMetaData.logSuccess()
      done.resolve true
    else if testStatus?.status is STATUS.FAIL
      browserMetaData.logFailure()
      done.resolve false
    else
      done.reject new rerun.RejectError "Browser test errored on SauceLabs, Run: #{run}"

  done.promise


# group(3, [1, 2, 3, 4, 5, 6, 7, 8]) => [[1, 2, 3], [4, 5, 6], [7, 8]]

group = (n, array) ->
  result = []
  for i in [0 ... array.length] by n
    g = []
    for j in [0 ... n]
      g.push array[i + j] if i + j < array.length
    result.push(g) if g.length > 0
  result

run = 0
singleBrowserTimeout = 90 * 1000 # ms

retry = rerun.promise
genTask = (browserCapabilities) ->
  ++run
  metaData = new BrowserTestMetaData run, browserCapabilities
  browsersMetaData[run] = metaData
  ->
    promise = retry ->
      metaData.increaseTryCount()
      metaData.logTimeout() if metaData.tryCount > 1
      runTestsOnBrowser(metaData, browserCapabilities).timeout singleBrowserTimeout, "Browser timed out"
    ,
      retries: 2
      retryTimeout: 100 # ms
      retryFactor: 1

    promise.catch (error) ->
      erroredBrowsersCount++
      metaData.logError error

runBrowsersInParallel = (group) ->
  tasks = _.map(group, genTask)
  ->
    parallel(tasks).then (result) ->
      _.every result, (e) -> e is true
    ,
      (error) ->
        console.log "Parallel caught error"
        console.log error

runGroupsInSequence = (groups) ->
  tasks = _.map(groups, runBrowsersInParallel)
  sequence(tasks).then (result) ->
    result = _.every result, (e) -> e is true
    console.log '\n\n-------- STATISTICS --------'
    console.log 'Total browsers:   ' + testConfig.browsers.length
    console.log 'Browsers passed:  ' + passedBrowsersCount
    console.log 'Browsers failed:  ' + failedBrowsersCount
    console.log 'Browsers errored: ' + erroredBrowsersCount
    console.log '----------------------------\n\n'
    if result
      exitStatus = 0
      exitIfFinished()
    else
      exitStatus = 1
      exitIfFinished()
  ,
    (error) ->
      console.log error
      exitStatus = 2
      exitIfFinished()

numberOfTestsToRunInParallel = testConfig.parallelTests ? 1

runGroupsInSequence(group(numberOfTestsToRunInParallel, testConfig.browsers))

exitIfFinished = ->
  return if httpRequestsWithoutResponse or exitStatus is null
  console.log "Exiting with status #{exitStatus}"
  process.exit exitStatus
