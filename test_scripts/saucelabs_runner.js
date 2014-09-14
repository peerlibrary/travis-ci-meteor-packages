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

var SauceLabs = {
  username: null,
  apikey: null,

  createClient: function () {
    if (!this.username || !this.apikey) throw new Error("User credentials not set");
    return wdSync.remote(
      'ondemand.saucelabs.com',
      80,
      this.username,
      this.apikey
    );
  },

  setTestResult: function (sessionId, isPassed) {
    if (!this.username || !this.apikey) throw new Error("User credentials not set");
    if (!sessionId) throw new Error("Session ID not set");
    var result = _when.defer();

    httpRequestsWithoutResponse++;
    try {
      var body = new Buffer(JSON.stringify({passed: isPassed}));

      var request = http.request({
        hostname: 'saucelabs.com',
        port: 80,
        path: '/rest/v1/' + this.username + '/jobs/' + sessionId,
        method: 'PUT',
        auth: this.username + ':' + this.apikey,
        headers: {'Content-length': body.length}
      }, function (response) {
        httpRequestsWithoutResponse--;
        if (response.statusCode === 200) {
          result.resolve();
        } else {
          result.reject('Http status code ' + response.statusCode);
        }
        exitIfFinished();
      });

      request.on('error', function (error) {
        httpRequestsWithoutResponse--;
        result.reject(error);
        exitIfFinished();
      });

      request.write(body);
      request.end();
    } catch (error) {
      httpRequestsWithoutResponse--;
      exitIfFinished();
      result.reject(error);
    }

    return result.promise;
  }
}

var BrowserTest = (function () {
  function BrowserTest (browserCapabilities, minimumPassedTestsOnClientRequired,
                        minimumPassedTestsOnServerRequired) {
    this.run = ++totalBrowserRunCount;
    this.tryCount = 0;
    this.browserCapabilities = browserCapabilities;
    this.minimumPassedTestsOnClientRequired = minimumPassedTestsOnClientRequired || 0;
    this.minimumPassedTestsOnServerRequired = minimumPassedTestsOnServerRequired || 0;
  }

  BrowserTest.prototype.getDescription = function () {
    return this.browserCapabilities.browserName +
           " " + this.browserCapabilities.version +
           " on " + this.browserCapabilities.platform;
  }

  BrowserTest.prototype.increaseTryCount = function () {
    this.tryCount++;
  }

  BrowserTest.prototype.getTryCount = function() {
    return this.tryCount;
  }

  BrowserTest.prototype.setTestResult = function (testResult) {
    if (this.testResult)
      return; // Do not allow overriding existing test result

    var reportAPIError = function (error) {
      this.logVerbose("Error setting test status on SauceLabs: " + error.toString());
    }

    this.testResult = testResult;
    if (this.testResult && this.testResult.status === STATUS.PASS) {
      passedBrowsersCount++;
      this.logVerbose("Setting test status on SauceLabs");
      SauceLabs.setTestResult(this.sessionId, true).catch(reportAPIError);
    } else if (this.testResult && this.testResult.status === STATUS.FAIL) {
      failedBrowsersCount++;
      this.logVerbose("Setting test status on SauceLabs");
      SauceLabs.setTestResult(this.sessionId, false).catch(reportAPIError);
    } else {
      erroredBrowsersCount++;
    }
  }

  BrowserTest.prototype.isPassed = function () {
    return this.testResult && this.testResult.status === STATUS.PASS;
  }

  BrowserTest.prototype.isFailed = function() {
    return this.testResult && this.testResult.status === STATUS.FAIL;
  }

  BrowserTest.prototype.isErrored = function() {
    return !this.testResult || !this.testResult.status || this.testResult.status === STATUS.ERROR ||
           this.testResult.status !== STATUS.PASS && this.testResult.status !== STATUS.FAIL;
  }

  BrowserTest.prototype.getErrorDetails = function() {
    if (this.testResult && this.testResult.errorDetails ) {
      return this.testResult.errorDetails;
    } else {
      return "Unknown error";
    }
  }

  BrowserTest.prototype.getTestCounts = function () {
    if (this.testResult && typeof this.testResult.passedCount !== 'undefined' &&
        typeof this.testResult.failedCount !== 'undefined') {

      return this.testResult.passedCount + " tests passed, " +
             this.testResult.failedCount + " tests failed"
    } else {
      return "Invalid test status";
    }
  }

  BrowserTest.prototype.getTestDetailsLink = function() {
    if (this.sessionId) {
      return "Details on SauceLabs: https://saucelabs.com/tests/" + this.sessionId;
    } else {
      return "Unable to generate test details link because test did not initialize on SauceLabs"
    }
  }

  // Logging methods
  BrowserTest.prototype.logVerbose = function (message) {
    console.log(this.run + ': ' + message);
  }

  BrowserTest.prototype.logLaunch = function () {
    if (this.tryCount === 1) {
      console.log("\n" + clc.whiteBright.bold.bgMagenta("## Launching browser " + this.getDescription() + "\n"));
    } else {
      console.log("\n" + clc.whiteBright.bold.bgMagenta("## Relaunching browser " + this.getDescription() + " (Try " + this.tryCount + ")\n"));
    }
  }

  BrowserTest.prototype.logSuccess = function () {
    console.log("\n" + clc.whiteBright.bold.bgGreen("## Test passed in " + this.getDescription()));
    console.log(clc.whiteBright.bold.bgGreen("## " + this.getTestCounts()));
    console.log(clc.whiteBright.bold.bgGreen("## " + this.getTestDetailsLink() + "\n"));
  }

  BrowserTest.prototype.logFailure = function() {
    console.log("\n" + clc.whiteBright.bold.bgRed("## Test failed in " + this.getDescription()));
    console.log(clc.whiteBright.bold.bgRed("## " + this.getTestCounts()));
    console.log(clc.whiteBright.bold.bgRed("## " + this.getTestDetailsLink() + "\n"));
  }

  BrowserTest.prototype.logError = function(error) {
    console.log("\n" + clc.whiteBright.bold.bgRed("## Test errored in " + this.getDescription()));
    console.log(clc.whiteBright.bold.bgRed("## Error: " + error.toString()));
    console.log(clc.whiteBright.bold.bgRed("## " + this.getTestDetailsLink() + "\n"));
  }

  BrowserTest.prototype.logTimeout = function(error) {
    console.log("\n" + clc.whiteBright.bold.bgRed("## Test timed out in " + this.getDescription()));
    console.log(clc.whiteBright.bold.bgRed("## Retrying...\n"));
  }

  // Test implementation
  var now = function () {
    return new Date().getTime();
  }

  // Params:
  //   timeout: poll timeout in ms
  //   interval: poll interval in ms
  //   progressFunction: progress callback
  //   testFunction: function which tests if polling is over
  var poll = function(params) {
    var give_up = now() + params.timeout;
    while (true) {
      var ok = params.testFunction();
      if (ok !== null && typeof ok !== 'undefined') {
        return ok;
      } else if (now() > give_up) {
        return null;
      } else {
        if (params.progressFunction !== null && typeof params.progressFunction !== 'undefined') {
          params.progressFunction();
          wdSync.sleep(params.interval);
        }
      }
    }
  }

  // Creates client on SauceLabs
  BrowserTest.prototype.createClient = function() {
    var client = SauceLabs.createClient();
    var browserTest = this;
    client.browser.on('status', function(info) {
      browserTest.logVerbose("Status: " + info);
    });
    client.browser.on('command', function(meth, path) {
      browserTest.logVerbose("Command: " + meth + " " + path);
    });
    return client;
  }

  // Runs tests
  BrowserTest.prototype.runTests = function() {
    var done = _when.defer();

    this.logLaunch();
    var client = this.createClient();
    var browser = client.browser;
    var self = this;

    client.sync(function () {
      var testStatus = null;
      try {
        // Initiate browser
        self.sessionId = browser.init(self.browserCapabilities);
        browser.setImplicitWaitTimeout(1000);

        // Get main (and only) browser window
        windowHandles = browser.windowHandles();
        if (windowHandles.length !== 1) throw new Error("Expected one open window.");
        mainWindowHandle = windowHandles[0];

        // Load test URL in browser
        browser.get(url);

        // Wait for test table to appear. When it does, tests are running.
        var ok = poll({
          timeout: 10000,
          interval: 1000,
          testFunction: function() {
            return browser.hasElementByCssSelector('.test_table');
          },
          progressFunction: function() {
            self.logVerbose("Waiting for .test_table div to appear");
          }
        });
        self.logVerbose("Tests are running");

        // Check test results
        result = poll({
          timeout: 40000,
          interval: 1000,
          testFunction: function() {
            clientTestFilter = function (element) {
              return element.text().search('C: ') >= 0;
            }
            serverTestFilter = function (element) {
              return element.text().search('S: ') >= 0;
            }

            // Focus main window
            browser.window(mainWindowHandle);

            // Check status divs
            var runningCount = browser.elementsByCssSelector('.running').length;
            var failedCount = browser.elementsByCssSelector('.failed').length;
            var passedCount = browser.elementsByCssSelector('.succeeded').length;
            var clientPassedCount = _.countBy(browser.elementsByCssSelector('.succeeded'), clientTestFilter).true;
            var serverPassedCount = _.countBy(browser.elementsByCssSelector('.succeeded'), serverTestFilter).true;

            // Determine test status
            if (runningCount == 0 && failedCount == 0 && passedCount > 0 &&
                clientPassedCount >= self.minimumPassedTestsOnClientRequired &&
                serverPassedCount >= self.minimumPassedTestsOnServerRequired) {
              return {
                status: STATUS.PASS,
                passedCount: passedCount,
                clientPassedCount: clientPassedCount,
                serverPassedCount: serverPassedCount,
                failedCount: 0
              };
            }
            else if (runningCount == 0) {
              return {
                status: STATUS.FAIL,
                passedCount: passedCount,
                clientPassedCount: clientPassedCount,
                serverPassedCount: serverPassedCount,
                failedCount: failedCount
              };
            }
            else {
              return null;
            }
          },
          progressFunction: function() {
            self.logVerbose("Waiting for tests to finish...");
          }
        });

        if (!result) {
          throw new Error("Tests did not complete within timeout.");
        }
      } catch (error) {
        self.logVerbose("Error: " + error);
        // Do not continue testing if error occurs. Do not try to set status because it will fail as well.
        self.setTestResult({
          status: STATUS.ERROR,
          errorDetails: error.message || error.toString()
        });
        done.reject(new rerun.RejectError(error.message));
        return;
      }

      // Shut down browser
      try {
        self.logVerbose("Shutting down the browser");
        browser.quit();
      } catch (error) {
        self.logVerbose("Unable to shut down browser. Error " + error);
      }

      // Set test result
      self.setTestResult(result);

      // Log status and resolve
      if (self.isPassed()) {
        self.logSuccess();
        done.resolve(true);
      } else if (self.isFailed()) {
        self.logFailure();
        done.resolve(false);
      } else {
        done.reject(new rerun.RejectError("Browser test errored on SauceLabs"));
      }
    });

    return done.promise;
  }

  return BrowserTest;
})();
// Each test will be stored in this array. That way we can easily summarize data at the end.
var browserTests = [];

var readJsonFile = function (filePath) {
  var contents = fs.readFileSync(filePath, 'utf-8');
  try {
    var json = JSON.parse(contents);
  } catch (error) {
    console.log("Unable to parse " + filePath + " as JSON:");
    console.log(error);
    process.exit(1);
  }
  return json;
}

// Check environment variables, set defaults
if (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY) {
  console.log("SAUCE_USERNAME and SAUCE_ACCESS_KEY environment variables are requrired.");
  process.exit(1);
} else {
  SauceLabs.username = process.env.SAUCE_USERNAME;
  SauceLabs.apikey = process.env.SAUCE_ACCESS_KEY;
}
if (!process.env.SAUCELABS_REQUIRE_SERVER_TEST) process.env.SAUCELABS_REQUIRE_SERVER_TEST = '0';
if (!process.env.SAUCELABS_REQUIRE_CLIENT_TEST) process.env.SAUCELABS_REQUIRE_CLIENT_TEST = '1';
var minimumRequiredServerTests = 0;
var minimumRequiredClientTests = 0;
if (process.env.SAUCELABS_REQUIRE_CLIENT_TEST == '1') minimumRequiredServerTests = 1;
if (process.env.SAUCELABS_REQUIRE_SERVER_TEST == '1') minimumRequiredClientTests = 1;

// Check CLI arguments and read config file
var testConfigFile = process.argv[2];
if (!testConfigFile) {
  console.log("Specify the SauceLabs test config JSON file on the command line");
  process.exit(1);
}
var testConfig = readJsonFile(testConfigFile);

var url = process.argv[3];
if (!url) {
  console.log("Specify the Meteor tinytest application URL");
  process.exit(1);
}

// Generate single browser test task
var singleBrowserTimeout = 90 * 1000 // ms
var retry = rerun.promise;
var genTask = function (browserCapabilities) {
  browserCapabilities = _.extend(browserCapabilities, {
    'max-duration': 120,
    name: testConfig.name,
    'tunnel-identifier': process.env.TRAVIS_JOB_NUMBER
  });
  var browserTest = new BrowserTest(browserCapabilities, minimumRequiredClientTests, minimumRequiredServerTests);
  browserTests.push(browserTest);
  return function () {
    var promise = retry(function() {
      browserTest.increaseTryCount();
      if (browserTest.getTryCount() > 1) browserTest.logTimeout();
      return browserTest.runTests().timeout(singleBrowserTimeout, "Browser timed out.");
    }, {
      retries: 2,
      retryTimeout: 20 * 1000, // ms
      retryFactor: 1
    });

    return promise.catch(function (error) {
      console.log("Try caught error: " + error);
      browserTest.setTestResult({
        status: STATUS.ERROR,
        errorDetails: error.toString()
      });
      browserTest.logError(error);
    });
  };
}

// Generate task list
var tasks = _.map(testConfig.browsers, genTask);

// Execute tasks from task list in sequence
sequence(tasks).then(function (result) {
  var result = _.every(result, function (element) { return element === true });
  outputSummary();
  if (result) {
    exitStatus = 0;
    exitIfFinished();
  } else {
    exitStatus = 1;
    exitIfFinished();
  }
}, function (error) {
  console.log(error);
  exitStatus = 2;
  exitIfFinished();
});

var outputSummary = function() {
  console.log("\n\n\n" + clc.bold("================ SUMMARY ================"));
  console.log(clc.bold("  Total browsers tested: " + testConfig.browsers.length));
  console.log(clc.bold("  Browsers passed: " + passedBrowsersCount));
  console.log(clc.bold("  Browsers failed: " + failedBrowsersCount));
  console.log(clc.bold("  Browsers errored: " + erroredBrowsersCount));

  if (failedBrowsersCount > 0) {
    console.log("\n" + clc.bold("  FAILED TESTS:"));
    for (var run in browserTests) {
      var browserTest = browserTests[run];
      if (browserTest.isFailed()) {
        console.log("    Browser: " + browserTest.getDescription())
        console.log("    Total tests ran: " + (browserTest.testResult.passedCount + browserTest.testResult.failedCount));
        console.log("    Total tests passed: " + browserTest.testResult.passedCount);
        console.log("    Tests passed on client: " + browserTest.testResult.clientPassedCount);
        console.log("    Tests passed on server: " + browserTest.testResult.serverPassedCount);
        console.log("    Total tests failed: " + browserTest.testResult.failedCount);
        console.log("    " + browserTest.getTestDetailsLink() + "\n");
      }
    }
  }

  if (erroredBrowsersCount > 0) {
    console.log("\n" + clc.bold("  ERRORED TESTS:"));
    for (var run in browserTests) {
      var browserTest = browserTests[run];
      if (browserTest.isErrored()) {
        console.log("    " + browserTest.getDescription());
        console.log("    Error details: " + browserTest.getErrorDetails());
        console.log("    " + browserTest.getTestDetailsLink() + "\n");
      }
    }
  }

  console.log(clc.bold("=========================================\n\n"));
}

var exitIfFinished = function() {
  if (httpRequestsWithoutResponse > 0 || exitStatus === null) return;
  console.log("Exiting with status " + exitStatus);
  process.exit(exitStatus);
}

