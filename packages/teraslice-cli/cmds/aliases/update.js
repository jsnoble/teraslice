// update existing cluster
// create new

'use strict';
'use console';

const _ = require('lodash');
const reply = require('../lib/reply')();
const config = require('../lib/config');
const cli = require('./lib/cli');

exports.command = 'update <cluster_sh>';
exports.desc = 'Update an alias to the clusters defined in the config file.\n';
exports.builder = (yargs) => {
    cli().args('aliases', 'list', yargs);
    yargs
        .option('host-cluster', {
            alias: 'c',
            describe: 'cluster host name',
            default: 'http://localhost:5678'
        })
        .example('teraslice-cli aliases update cluster1 -c http://cluster1.net:80');
};

exports.handler = (argv, _testFunctions) => {
    const cliConfig = _.clone(argv);
    config(cliConfig, 'aliases:update').returnConfigData(false, false);
    const libAliases = _testFunctions || require('./lib')(cliConfig);
    return libAliases.update()
        .catch(err => reply.fatal(err.message));
};
