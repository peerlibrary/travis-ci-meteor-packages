#!/usr/bin/env node

var spawn = require('child_process').spawn;
var _ = require('underscore');
var _when = require('when');
var sequence = require('when/sequence');

// Default values for environment variables
if (!process.env.TEST_SCRIPTS_DIR) process.env.TEST_SCRIPTS_DIR = './.test_scripts';
if (!process.env.TEST_ON_PHANTOMJS) process.env.TEST_ON_PHANTOMJS = '1';
if (!process.env.TEST_ON_SAUCELABS) process.env.TEST_ON_SAUCELABS = '0';

// Tests are defined here
var testsToRun = [{
  script: 'phantom_wrapper.js',
  enabled: process.env.TEST_ON_PHANTOMJS == '1'
}, {
  script: 'saucelabs_wrapper.js',
  enabled: process.env.TEST_ON_SAUCELABS == '1'
}];

var start = function (script) {
  var done = _when.defer();

  var scriptProcess = spawn('node', [script], {stdio: 'inherit'});

  scriptProcess.on('close', function (code) {
    console.log("Script process exited with code " + code);
    done.resolve(code === 0);
  });

  scriptProcess.on('error', function (error) {
    console.log("Script errored: " + error.toString());
    done.reject();
  });

  return done.promise
}

var genTask = function (script) {
  return function () {
    return start(process.env.TEST_SCRIPTS_DIR + '/' + script);
  }
}

var tasks = testsToRun.map(function (test) {
  if (test.enabled) {
    return genTask(test.script);
  }
}).filter(_.isFunction);

sequence(tasks).then(function (results) {
  if (_.every(results)) {
    console.log("All tests passed, exiting with status 0");
    process.exit(0);
  } else {
    console.log("Some tests failed, exiting with status 1");
    process.exit(1);
  }
}, function (error) {
  console.log("Got error from tests script: " + error);
  process.exit(1);
});
