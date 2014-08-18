travis-ci-meteor-packages
=========================

### [Travis CI support for Meteor (Smart) Packages](http://meteorhacks.com/travis-ci-support-for-meteor-packages.html)

Add following file to your meteor package as `.travis.yml`

    language: node_js
    node_js:
      - "0.10"
    before_install:
      - "curl -L http://git.io/ejPSng | /bin/sh"

Login to [https://travis-ci.org](https://travis-ci.org) with Github and navigate to [https://travis-ci.org/profile](https://travis-ci.org/profile)

Enable travis support for your project listed there.

![Meteor Cluster - Travis Support](http://i.imgur.com/JY9o3xm.png)

You can configure tests with two environment variables:
 * `WORKING_DIR` -- working directory to run `mrt` from
 * `PACKAGES` -- list of package names or directories to test, separated by `;`, by default `./`; specfiy empty string to test all packages

See [here](http://meteorhacks.com/travis-ci-support-for-meteor-packages.html) for more information

### Test your Meteor package in various browsers on [SauceLabs](http://saucelabs.com)

Sign up on SauceLabs if you don't have an account. You need username and access key. When you have those, follow [these instructions](https://docs.saucelabs.com/ci-integrations/travis-ci/) to add it to `.travis.yml` as environment variables and enable Sauce Connect.

Configure browsers you want to run tests on in `.saucelabs_config.json` file. It should look like this:

```
{
  "name": "Your test name",
  "where": "saucelabs",
  "parallelTests": 1,
  "browsers": [
    { "browserName": "chrome", "version": "26", "platform": "Windows 7" },
    { "browserName": "chrome", "version": "36", "platform": "Windows 7" },
    { "browserName": "chrome", "version": "beta", "platform": "Windows 7" },
    { "browserName": "firefox", "version": "15", "platform": "Windows 7" },
    { "browserName": "firefox", "version": "30", "platform": "Windows 7" },
    { "browserName": "firefox", "version": "31", "platform": "Windows 7" },
  ]
}
```

You can find a list of supported browsers and platforms [here](https://saucelabs.com/platforms/selenium)

Update `.travis.yml` file like this:

    language: node_js
    node_js:
      - "0.10"
    before_install:
      - curl https://raw.githubusercontent.com/peerlibrary/travis-ci-meteor-packages/saucelabs/configure.sh | /bin/sh
    script:
      - coffee start_test.coffee
    env:
      global:
      - secure: "Secure username token goes here!"
      - secure: "Secure access key token goes here!"
      - TEST_ON_PHANTOMJS=1
      - TEST_ON_SAUCELABS=1
    addons:
      sauce_connect: true

Sauce Connect is an addon for Travis which opens secure tunnel to SauceLabs so that remote browsers can access your app through localhost.
There are also two additional environment variables:
 * `TEST_ON_PHANTOMJS` - PhantomJS tests will run if set to 1
 * `TEST_ON_SAUCELABS` - SauceLabs tests will run if set to 1
