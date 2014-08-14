#!/usr/bin/env coffee
spawn = require('child_process').spawn
_ = require 'underscore'
_when = require 'when'
sequence = require 'when/sequence'

TEST_SCRIPTS = ['phantomjs_test.coffee', 'saucelabs_test.coffee']
process.env.TEST_SCRIPTS_DIR = './.test_scripts' unless process.env.TEST_SCRIPTS_DIR?

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
tasks.push genTask script for script in TEST_SCRIPTS

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
