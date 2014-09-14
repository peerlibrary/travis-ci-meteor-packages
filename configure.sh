#!/bin/sh

#creating directory structure
mkdir .test_scripts

#downloading scripts
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/Makefile
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/package.json
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/start_test.js

wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/test_scripts/phantom_wrapper.js -O .test_scripts/phantom_wrapper.js
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/test_scripts/phantom_runner.js -O .test_scripts/phantom_runner.js
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/test_scripts/saucelabs_wrapper.js -O .test_scripts/saucelabs_wrapper.js
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/test_scripts/saucelabs_runner.js -O .test_scripts/saucelabs_runner.js

#installing meteor
curl https://install.meteor.com | /bin/sh

#installing meteorite
npm install -g meteorite

#installing dependencies defined in package.json
npm install

mrt update
