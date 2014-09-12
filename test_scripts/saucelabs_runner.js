console.log("Running Meteor tests on SauceLabs");

var _ = require('underscore');
var fs = require('fs');
var http = require('http');
var webdriver = require('wd');
var wdSync = require('wd-sync');
var _when = require('when');
var parallel = require('when/parallel');
var sequence = require('when/sequence');
var rerun = require('rerun');
var clc = require('cli-color');

var httpRequestsWithoutResponse = 0;
var exitStatus = null;
var passedBrowsersCount = 0;
var failedBrowsersCount = 0;
var erroredBrowsersCount = 0;
var totalBrowserRunCount = 0;

var STATUS = {
  PASS: 'pass',
  FAIL: 'fail',
  ERROR: 'error'
};

var SauceLabs = (function () {
  function SauceLabs () {
    if (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY) {
      throw new Error("SAUCE_USERNAME and SAUCE_ACCESS_KEY environment variables are required.");
    }
    this.username = process.env.SAUCE_USERNAME;
    this.apikey = process.env.SAUCE_ACCESS_KEY;
  };

  SauceLabs.prototype.createBrowser = function () {
    return wdSync.remote(
      'ondemand.saucelabs.com',
      80,
      this.username,
      this.apikey
    );
  }

  SauceLabs.prototype.setSaucelabsTestResult = function (sessionId, isPassed) {
    var result = _when.defer();

    try {
      var body = new Buffer(JSON.stringify({isPassed}));
      httpRequestsWithoutResponse++;

      var request = http.request({
        hostname: 'saucelabs.com',
        port: 80,
        path: '/rest/v1/' + this.username + '/jobs/' + sessionId,
        method: 'PU',
        auth: this.username + ':' + this.apikey,
        headers: {'Content-length': body.length}
      }, function (response) {
        httpRequestsWithoutResponse--;
        if (response.statusCode === 200) {
          result.resolve();
        } else {
          result.reject('http status code ' + res.statusCode);
        }
        exitIfFinished();
      });
    } catch (error) {
      result.reject(error);
    }

    return result.promise;
  }

  return SauceLabs;
})();

var BrowserTest = (function () {
  function BrowserTest (sauceLabs, browserCapabilities) {
    this.run = totalBrowserRunCount++;
    this.tryCount = 0;
    this.browserCapabilities = browserCapabilities;
    this.sauceLabs = sauceLabs;
  }

  BrowserTest.prototype.getDescription = function () {
    return this.browserCapabilities.browserName +
           " " + this.browserCapabilities.version +
           " on " + browserCapabilities.platform;
  }

  BrowserTest.prototype.increaseTryCount = function () {
    this.tryCount++;
  }

  BrowserTest.prototype.setTestResult = function (testResult) {
    if (this.testResult)
      return; // Do not allow overriding existing test result

    this.testResult = testResult;
    if (this.testResult && this.testResult.status === STATUS.PASS) {
      passedBrowsersCount++;
    } else if (this.testResult && this.testResult.status === STATUS.FAIL) {
      failedBrowsersCount++;
    } else {
      erroredBrowsersCount++;
    }
    this.sauceLabs.setTestResult(this.sessionId, testResult);
  }

  BrowserTest.prototype.logVerbose = function (message) {
    console.log(this.run + ': ' + message);
  }

  BrowserTest.prototype.logVerbose

  return BrowserTest;
})();

