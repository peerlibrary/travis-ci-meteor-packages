#!/usr/bin/env coffee
spawn = require('child_process').spawn
_ = require 'underscore'
_when = require 'when'
sequence = require 'when/sequence'

# Default values for environment variables
process.env.TEST_SCRIPTS_DIR = './.test_scripts' unless process.env.TEST_SCRIPTS_DIR?
process.env.TEST_ON_PHANTOMJS = '1' unless process.env.TEST_ON_PHANTOMJS?
process.env.TEST_ON_SAUCELABS = '0' unless process.env.TEST_ON_SAUCELABS?

testsToRun = [
  script: 'phantom_wrapper.coffee'
  enabled: process.env.TEST_ON_PHANTOMJS is '1'
,
  script: 'saucelabs_wrapper.coffee'
  enabled: process.env.TEST_ON_SAUCELABS is '1'
]

start = (script) ->
  done = _when.defer()

  scriptProcess = spawn 'coffee', [script]
  scriptProcess.stdout.pipe process.stdout
  scriptProcess.stderr.pipe process.stderr

  scriptProcess.on 'close', (code) ->
    console.log "Script process exited with code #{code}"
    done.resolve code is 0

  scriptProcess.on 'error', (error) ->
    console.log "Script errored: " + error.toString()
    done.reject()

  done.promise

genTask = (script) ->
  -> start "#{process.env.TEST_SCRIPTS_DIR}/#{script}"

tasks = []
for test in testsToRun
  tasks.push genTask test.script if test.enabled

sequence(tasks).then (results) ->
  if _.every results
    console.log "All tests passed, exiting with status 0"
    process.exit 0
  else
    console.log "Some tests failed, exiting with status 1"
    process.exit 1
,
  (error) ->
    console.log "Got error from test script: " + error
    process.exit 1
